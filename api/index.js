// Vercel serverless entry point — runs the Express app.
//
// Static pages (the employee clock-in page + assets) are served by Vercel
// straight from /public. Everything else (the /api routes and the admin page)
// is routed here by vercel.json, and handled by the Express app.

const { app, connect } = require('../server');

let ready; // memoized DB connection, reused across warm invocations

module.exports = async (req, res) => {
  // Only the API needs the database. Static pages (the clock-in page, the admin
  // page, assets) are served without waiting on the DB, so the app still loads
  // even if the database is unreachable.
  if ((req.url || '').startsWith('/api/')) {
    try {
      if (!ready) ready = connect();
      await ready;
    } catch (err) {
      ready = null; // allow the next request to retry the connection
      console.error('Database connection failed:', err);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Database connection failed.', detail: err.message }));
      return;
    }
  }
  return app(req, res);
};
