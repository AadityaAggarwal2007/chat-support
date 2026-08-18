const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.agent = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authMiddleware };
