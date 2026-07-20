import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "prox-sms-verify-backend" });
});

// Route stubs — to be filled in next session
// app.use("/api/auth", authRoutes);
// app.use("/api/wallet", walletRoutes);
// app.use("/api/orders", orderRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`prox-sms-verify backend running on port ${PORT}`);
});
