const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ role: 'agent' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

router.get('/verify', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    res.json({ ok: true, payload });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
