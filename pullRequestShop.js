'use strict';

import _ from 'lodash'
import fsp from 'fs-promise';
import Git from 'nodegit';
import Octokat from 'octokat';
import parseGitHubURL from 'parse-github-url';
import path from 'path';
import { tmpNameSync } from 'tmp';
import { epoch } from './util.js';

// SlackStatsTable represents a table of the Slack stats over time. You can
// construct a table using this class and then export it as a TSV using the
// tsv() function.
//
// The table looks as follows, where the numbers in each column is the total
// number of messages sent by that user by that date.:
//
// | Users | 2015-11-25 | 2015-11-26 | 2015-11-27 |
// |-------|------------|------------|------------|
// | amy   | 445        | 600        | 832        |
// | bobby | 202        | 655        | 823        |
// | cathy | 750        | 1003       | 1230       |
class SlackStatsTable {
  constructor() {
    this.dates = [];
    this.userStats = {};
  }

  // Set the stored message count for a user at a specified date (where the date
  // corresponds to a column in the table)
  setMsgCount(user, date, msgCount) {
    if (!_.includes(this.dates, date)) {
      this.dates.push(date);
    }
    if (this.userStats[user] == null) {
      this.userStats[user] = {};
    }

    this.userStats[user][date] = msgCount;
  }

  // Returns a TSV string of the SlackStatsTable
  tsv() {
    let sortedDates = this.dates.sort();
    let headers = ['Users'].concat(sortedDates.map(d => d.toISOString()));
    let userRows = [];
    let exportStr = '';

    // Go through each of the user stats, construct a row of the user's data,
    // then append it to userRows
    _.each(this.userStats, (stats, user) => {
      let row = [user];

      _.each(sortedDates, date => {
        row.push(stats[date]);
      });

      userRows.push(row);
    });

    // Sort the user rows by the first element in each row (the user's name)
    userRows = _.sortBy(userRows, 0)

    // Time to construct our exported string!
    exportStr += headers.join('\t') + '\n';
    _.each(userRows, row => exportStr += row.join('\t') + '\n');

    return exportStr;
  }
}

// This continuously polls the given fork until its files are ready for
// modification. fork is expected to be a repo object from Octokat.
function waitForForkToBeReady(fork) {
  return new Promise((resolve, reject) => {
    // Check to see if we can access the fork files once every second. Give up
    // after 15 seconds.
    const checkInterval = 1000;
    const maxAttempts = 30;
    let attempts = 15;

    function checkFork() {
      fork.contents('').fetch()
        .then((contents) => {
          resolve(fork);
        })
        .catch((err) => {
          if (attempts >= maxAttempts) {
            return reject(
              new Error(`Gave up forking after ${maxAttempts} seconds`)
            );
          }

          attempts++;
          setTimeout(checkFork, checkInterval);
        });
    }

    setTimeout(checkFork, checkInterval);
  });
}

// Clones the given repo into a temporary directory and resolves the temporary
// path. repo is expected to be a repo object from Octokat.
function cloneIntoTempDir(repo) {
  const tempDirName = tmpNameSync();

  return Git.Clone(repo.cloneUrl, tempDirName)
    .then(repo => {
      return tempDirName;
    });
}

// Update the master branch of the repository on the local filesystem at
// forkPath with the changes from upstreamURL and push them to forkpath's
// origin.
function updateFork(octo, accessToken, forkPath, upstreamURL) {
  return Git.Repository.open(forkPath)
    .then(fork => {
      let remote = Git.Remote.create(fork, "upstream", upstreamURL);

      return fork.fetch(remote.name())
        .then(() => {
          return fork.getBranchCommit(`${remote.name()}/master`);
        })
        .then(latestUpstreamCommit => {
          return Git.Reset(fork, latestUpstreamCommit, Git.Reset.TYPE.HARD);
        })
        .then(() => push(octo, accessToken, forkPath, "master", true));
    })
    .then(() => forkPath);
}

// Creates a new branch in the repo in repoPath with branchName
function createBranch(repoPath, branchName) {
  return Git.Repository.open(repoPath)
    .then(repo => {
      return repo.getHeadCommit()
        .then(commit => {
          return repo.createBranch(
            branchName,
            commit,
            0,
            repo.defaultSignature(),
            `Created ${branchName} on HEAD`
          )
        })
    })
    .then(() => [repoPath, branchName]);
}

// Returns a suitable branch name for the given date
function branchNameFromDate(date) {
  function pad(number) {
    if (number < 10) {
      return '0' + number;
    }
    return number;
  }

  return date.getUTCFullYear() +
    '-' + pad(date.getUTCMonth() + 1) +
    '-' + pad(date.getUTCDate()) +
    '@' + pad(date.getUTCHours()) +
    '-' + pad(date.getUTCMinutes()) +
    '-' + pad(date.getUTCSeconds());
}

// Checkout the given branch
function checkoutBranch(repoPath, branch) {
  return Git.Repository.open(repoPath)
    .then(repo => repo.checkoutBranch(branch))
    .then(() => repoPath);
}

// This function opens the file specified in tsvFilename and updates it with the
// latest stats from Slack from slackStats. If the path at tsvFilename doesn't
// exist, then a new TSV file is created with the data from Slack stats.
function updateTSVWithStats(forkPath, tsvFilename, slackStats) {
  let tsvPath = path.resolve(forkPath, tsvFilename);
  let statsTable = new SlackStatsTable;

  // TODO load tsvPath into statsTable before doing this
  _.each(slackStats.members, (stats, user) => {
    statsTable.setMsgCount(user, slackStats.timestamp, stats.allTime);
  });

  let statsTSV = statsTable.tsv();

  return fsp.writeFile(tsvPath, statsTSV)
    .then(() => {
      return [forkPath, tsvFilename];
    });
}

// commitChanges is a utility function for committing files. In the repository
// defined at repoPath, the files defined in files are committed with the commit
// message in commitMsg. The name and email attached to the commit is pulled
// from GitHub's API using the octokat client passed in.
function commitChanges(
  octokat,
  repoPath,
  files,
  commitMsg
) {
  return octokat.me.fetch()
    .then(me => {
      let signature = Git.Signature.create(me.name, me.email, epoch(), 0);
      return Git.Repository.open(repoPath)
        .then(repo => repo.createCommitOnHead(
          files,
          signature,
          signature,
          commitMsg
        ));
    })
    .then(() => repoPath);
}

function push(octokat, token, repoPath, branch, force=false) {
  return octokat.me.fetch()
    .then(me => {
      return Git.Repository.open(repoPath)
        .then(repo => {
          let remoteToGet = "origin";

          // If a branch wasn't provided, use the repo's current branch
          if (!branch) {
            return repo.getCurrentBranch()
              // This is a little odd, but ref.shorthand will return the branch
              // name
              .then(ref => branch = ref.shorthand())
              .then(() => repo.getRemote(remoteToGet));
          }

          return repo.getRemote(remoteToGet);
        })
        .then(remote => {
          let refspec = `refs/heads/${branch}:refs/heads/${branch}`;

          // Add + to the beginning of the refspec if we want to force push
          if (force) {
            refspec = '+' + refspec;
          }

          return remote.push(
            [refspec],
            {
              callbacks: {
                credentials: (url, username) => {
                  return Git.Cred.userpassPlaintextNew(me.login, token);
                }
              }
            }
          );
        });
    })
    .then(() => repoPath);
}

// Submit a new pull request to GitHub.
//
// octo - Octokat client
// repo - Octokat repo object
// slackStats - Slack stats object
// branchName - Name of branch to submit pull request from
function createPullRequest(octo, repo, slackStats, branchName) {
  let date = slackStats.timestamp;
  let shortDate =
      `${date.getUTCFullYear()}-${date.getUTCMonth()+1}-${date.getUTCDate()}`;

  let totalMsgs = _.reduce(slackStats.members, (a, b) => a + b.allTime, 0);
  let allTimeMostActive = _.findKey(
    slackStats.members,
    _.max(slackStats.members, m => m.allTime)
  );
  let last7DaysMostActive = _.findKey(
    slackStats.members,
    _.max(slackStats.members, m => m.last7Days)
  );

  let title = `Add latest Slack stats from ${shortDate}`;
  let body =
`This pull request adds the latest Slack stats from ${shortDate} to the \`slack_stats.tsv\` file.

As of ${date.toUTCString()}, there have been ${totalMsgs} messages sent in the Slack. The most active user of all time is \`${allTimeMostActive}\`, who has sent ${slackStats.members[allTimeMostActive].allTime} messages in total. The most active user in the past 7 days is \`${last7DaysMostActive}\`, who sent ${slackStats.members[last7DaysMostActive].last7Days} messages.

_Note: all times are UTC._

--------------------------------------------------------------------------------

_This pull request is brought to you by [\`slack-stats-collector\`](https://github.com/hackclub/slack-stats-collector)_`;

  return octo.me.fetch()
    .then(me => {
      return repo.pulls.create({
        title: title,
        body: body,
        head: `${me.login}:${branchName}`,
        base: "master"
      });
    });
}

export function makePullRequest(accessToken, repoURL, slackStats) {
  let octo = new Octokat({ token: accessToken });
  let parsedRepoURL = parseGitHubURL(repoURL);

  let repo = octo.repos(parsedRepoURL.user, parsedRepoURL.repo)

  // 1. Fork the repo (if a fork already exists, it proceeds anyways)
  // 2. Forks aren't instantaneous, so poll for file contents until the fork is
  //    ready for us to modify.
  // 3. Clone the fork into a temporary directory
  // 4. Update the fork with the latest changes from upstream and push them to
  //    origin
  // 5. Create a new branch
  // 6. Checkout the new branch
  // 7. Make our changes
  // 8. Commit our changes
  // 9. Push our changes
  // 10. Submit the pull request
  // 11. Delete our temporary local repo
  return repo.forks.create()
    .then(waitForForkToBeReady)
    .then(cloneIntoTempDir)
    .then(forkPath => updateFork(octo, accessToken, forkPath, repoURL))
    .then(forkPath => createBranch(
      forkPath,
      branchNameFromDate(slackStats.timestamp)
    ))
    .then(res => {
      let [forkPath, branch] = res;
      return checkoutBranch(forkPath, branch);
    })
    .then(forkPath => updateTSVWithStats(
      forkPath,
      'slack_stats.tsv',
      slackStats
    ))
    .then(res => {
      let [forkPath, tsvPath] = res;

      return commitChanges(
        octo,
        forkPath,
        [tsvPath],
        'Add latest Slack stats'
      );
    })
    .then(forkPath => push(octo, accessToken, forkPath))
    .then(forkPath => createPullRequest(
      octo,
      repo,
      slackStats,
      branchNameFromDate(slackStats.timestamp)
    ));
};
