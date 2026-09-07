require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const categoriesRouter = require('./routes/categories');
const nomineesRouter = require('./routes/nominees');
const votesRouter = require('./routes/votes');
const settingsRouter = require('./routes/settings');
const realtime = require('./lib/realtime');
const reconcileJob = require('./jobs/reconcileJob');

const app = express();
const httpServer = http.createServer(app);

// Socket.IO — real-time vote/results/earnings updates. FRONTEND_URL must be set correctly
// in .env or the browser will be blocked by CORS when connecting the socket.
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || '*' },
});
realtime.init(io);

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[socket] client disconnected: ${socket.id}`));
});

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
httpServer.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  reconcileJob.start(); // auto-checks stuck pending payments every 90s, no admin click needed
});
