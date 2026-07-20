require('dotenv').config();
const express = require('express');
const cors = require('cors');

const categoriesRouter = require('./routes/categories');
const nomineesRouter = require('./routes/nominees');
const votesRouter = require('./routes/votes');
const settingsRouter = require('./routes/settings');

const app = express();

app.use(cors());

// IMPORTANT: the webhook route (defined inside votesRouter) needs the RAW body
// to verify the Paystack signature. So we skip global JSON parsing for that
// one path and let the route's own express.raw() middleware handle it.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/votes/webhook') return next();
  express.json()(req, res, next);
});

app.use('/api/categories', categoriesRouter);
app.use('/api/nominees', nomineesRouter);
app.use('/api/votes', votesRouter);
app.use('/api/settings', settingsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
