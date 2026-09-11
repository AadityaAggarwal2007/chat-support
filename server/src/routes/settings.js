const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getActiveModel, setActiveModel, getModelList, getChain } = require('../ai');
const router = express.Router();

router.use(authMiddleware);

router.get('/ai', (req, res) => {
  // Pricing stays server-side; the dashboard shows names and order only.
  const models = Object.fromEntries(
    Object.entries(getModelList()).map(([id, m]) => [id, { name: m.name, free: Boolean(m.free) }])
  );
  res.json({ activeModel: getActiveModel(), models, chain: getChain() });
});

router.patch('/ai', (req, res) => {
  const { model } = req.body;
  const models = getModelList();
  if (!model || !models[model]) {
    return res.status(400).json({ error: 'Invalid model', available: Object.keys(models) });
  }
  setActiveModel(model);
  res.json({ activeModel: model, name: models[model].name });
});

module.exports = router;
