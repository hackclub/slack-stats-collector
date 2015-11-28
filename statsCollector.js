'use strict';

import cheerio from 'cheerio';
import webdriverio from 'webdriverio';
const options = {
  desiredCapabilities: { browserName: 'chrome' },
  host: process.env.SELENIUM_PORT_4444_TCP_ADDR,
  port: process.env.SELENIUM_PORT_4444_TCP_PORT
};

// Go to Slack's admin statistics page, grabs all the member data, then returns
// an object containing the data. The object follows the following format (when
// serialized to JSON):
//
// {
//   "timestamp": "2015-11-27T04:39:45.737Z",
//   "members": {
//     "exampleUser": {
//       "last7Days": 242,
//       "allTime": 1382
//     },
//     "zrl": {
//       "last7Days": 421,
//       "allTime": 3232
//     }
//   }
// }
export function getStats(subdomain, email, password) {
  let client = webdriverio.remote(options);
  let stats = { timestamp: new Date() };

  return client
    .init()
    .url(`https://${subdomain}.slack.com?redir=%2Fadmin%2Fstats`)
    .setValue('#email', email)
    .setValue('#password', password)
    .click('#signin_btn')
    .getHTML('#member_stats')
      .then((html) => {
        let $ = cheerio.load(html);
        let memberStats = {};

        $('tr.member_row').each((i, tr) => {
          // Slack prefixes usernames with @ in on this page (ex. @zrl)
          let username = $(tr).find('.stats_username').text().replace('@', '');
          // This is a string with the number of messages sent in the past 7
          // days. We transform it to a number (strippig commas).
          let last7Days = Number(
            $(tr).find('.stats_week').text()
              .replace(',', '')
          );
          // This will look like "230 messages & 4 files" when we take it
          // from the page. We want to strip everything but the message count
          // and then convert it to a number (stripping commas).
          let allTime = Number(
            $(tr).find('.stats_all_time').text()
              .replace(/ messages.*$/, '')
              .replace(',', '')
          ) || 0;

          memberStats[username] = {
            last7Days: last7Days,
            allTime: allTime
          };
        });

        stats['members'] = memberStats;
      })
    .end()
    .then(() => stats)
    .catch(err => {
      return client.end()
        .then(() => err);
    });
};
