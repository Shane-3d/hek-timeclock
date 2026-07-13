// Vercel serverless entry point — runs the Express app.
//
// Static assets (public/*) are served by Vercel directly; every other path is
// routed here by vercel.json and handled by the Express app.
//
// All failures are caught and returned as readable JSON so a problem shows its
// real cause instead of an opaque Vercel "FUNCTION_INVOCATION_FAILED" page.

// Load the app up front. If this throws (e.g. a file missing from the deployed
// bundle), remember the error so every request can report it clearly rather
// than crashing the function on import.
let app = null;
let connect = null;
let loadError = null;
try {
  ({ app, connect } = require('../server'));
} catch (err) {
  loadError = err;
}

let ready = null; // memoized DB connection, reused across warm invocations

function sendError(res, status, error, detail) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error, detail: detail == null ? undefined : String(detail) }));
}

module.exports = async (req, res) => {
  // The app itself failed to load — surface the exact reason.
  if (loadError)
    return sendError(res, 500, 'App failed to load on the server.', loadError.stack || loadError);

  try {
    // Only the API needs the database; static and the admin page load without it,
    // so the site still comes up even if the database is unreachable.
    if ((req.url || '').startsWith('/api/')) {
      try {
        if (!ready) ready = connect();
        await ready;
      } catch (err) {
        ready = null; // allow the next request to retry the connection
        console.error('Database connection failed:', err);
        return sendError(res, 500, 'Database connection failed.', err.message);
      }
    }
    return app(req, res);
  } catch (err) {
    console.error('Unhandled request error:', err);
    return sendError(res, 500, 'Unhandled server error.', err.stack || err);
  }
};
