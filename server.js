const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let items = [];

app.get('/api/items', (req, res) => res.json(items));

app.post('/api/items', (req, res) => {
  const { name, who, category, urgency, note } = req.body;
  if (!name || !who || !category) return res.status(400).json({ error: 'name, who, category required' });
  const item = { id: uuidv4(), name, who, category, urgency: urgency || 'normal', note: note || '', createdAt: new Date().toISOString(), done: false };
  items.unshift(item);
  res.status(201).json(item);
});

app.patch('/api/items/:id', (req, res) => {
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  items[idx] = { ...items[idx], ...req.body };
  res.json(items[idx]);
});

app.delete('/api/items/done/all', (req, res) => {
  items = items.filter(i => !i.done);
  res.json({ ok: true });
});

app.delete('/api/items/:id', (req, res) => {
  items = items.filter(i => i.id !== req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Family List on http://localhost:${PORT}`));
