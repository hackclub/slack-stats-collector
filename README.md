# slack-stats-collector

slack-stats-collector scrapes the `https://subdomain.slack.com/admin/stats`
page, turns it into a TSV file, and then submits a pull request with the latest
changes to your GitHub repository of choice. Now you can track your Slack usage
activity in git.

The TSV it generates looks something along these lines, where each column after
the first represents the time of data collection scrape:

| Users | 2015-11-25T12:12:18.872Z | 2015-11-26T12:12:18.872Z |
| ----- | ------------------------ | ------------------------ |
| amy   |                      445 |                      600 |
| bobby |                      202 |                      655 |
| cathy |                      750 |                     1003 |
| jimmy |                      504 |                     1300 |

## Setup

Everything is set up using [Docker Compose](https://docs.docker.com/compose/).
Once you have it installed, set the following environment variables in a file
called `.env`:

- `GITHUB_ACCESS_TOKEN` - GitHub access token for the account you want to submit
  the pull requests from. Must have the `repo` permission
- `GITHUB_REPO_URL` - URL of the upstream repository you want your account
  submitting pull requests to. This will be forked and not modified directly.
- `SLACK_SUBDOMAIN` - Subdomain for the Slack you want to gather statistics
  from (ex. `myteam` in `https://myteam.slack.com`)
- `SLACK_EMAIL` - Email for the administrator account to use for gathering the
  Slack statistics. We recommend creating a separate account just for this
  project.
- `SLACK_PASSWORD` - Password for the aforementioned Slack account
- _(Optional)_ `PORT` - Port for the HTTP server to run on

Once you have all of those set, just run the following and you should be good to
go!

    $ docker-compose up

## Usage

Once up and running, the project exposes the following endpoints:

- `GET /stats` - Scraps `https://subdomain.slack.com/admin/stats` and returns
  the JSON output
- `POST /make-pull-request` - Scrapes `https://subdomain.slack.com/admin/stats`,
  converts the scraped data to a TSV, and submits a pull request with the
  changed data to the GitHub repository in `GITHUB_REPO_URL`

Responses are only returned after the action is fully complete. Since scraping
data from Slack's admin dashboard and all the git-fu can take a while, it can
take up to a few minutes to receive a response.

We have a cronjob set up to hit `/make-pull-request` daily, which submits a pull
request to our [`metrics`](https://github.com/hackclub/metrics) repository.

## License

See [LICENSE](LICENSE).
