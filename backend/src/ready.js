// Startup gate: the server accepts connections immediately but data routes 503 until the
// database has been initialized (see server.js start loop).
let ready = false;

export const isDbReady = () => ready;
export const setDbReady = (value) => { ready = !!value; };

export const requireDbReady = (_req, res, next) => {
  if (ready) return next();
  return res.status(503).json({ message: 'Server is warming up. Please retry shortly.' });
};
