'use strict';

import http from 'http';
import express from 'express';
import { getStats } from './statsCollector.js';
import { makePullRequest } from './pullRequestShop.js'

const githubAccessToken = process.env.GITHUB_ACCESS_TOKEN;
const githubRepoURL = process.env.GITHUB_REPO_URL;
const slackSubdomain = process.env.SLACK_SUBDOMAIN;
const slackEmail = process.env.SLACK_EMAIL;
const slackPassword = process.env.SLACK_PASSWORD;

let app = express();
app.server = http.createServer(app);

app.get('/stats', (req, res) => {
  getStats(slackSubdomain, slackEmail, slackPassword)
    .then(stats => res.json(stats))
    .catch(err => {
      console.error(err);
      res.json({ error: err });
    });
});

app.post('/make-pull-request', (req, res) => {
  getStats(slackSubdomain, slackEmail, slackPassword)
    .then(stats => makePullRequest(
      githubAccessToken,
      githubRepoURL,
      stats
    ))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err.stack);
      res.json({ error: err });
    });
});

app.server.listen(process.env.PORT || 3000);
console.log(`Started on port ${app.server.address().port}`);

export default app;
