// Netlify serverless function that runs the Express API.
// The static pages (employee clock-in + admin) are served by Netlify from the
// published "dist" folder; only /api/* is routed here (see netlify.toml).

const serverless = require('serverless-http');
const { app, connect } = require('../../server');

const handler = serverless(app);

exports.handler = async (event, context) => {
  // Don't wait for the (reused) Mongo connection pool to drain before returning.
  context.callbackWaitsForEmptyEventLoop = false;
  await connect(); // memoized — connects on cold start, reused when warm
  return handler(event, context);
};
