const axios = require('axios');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = 'https://api.paystack.co';

const client = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  timeout: 15000,
});

async function initializeTransaction({ email, amount, reference, callback_url, metadata }) {
  const res = await client.post('/transaction/initialize', {
    email, amount, reference, callback_url, metadata,
  });
  return res.data.data; // { authorization_url, access_code, reference }
}

async function verifyTransaction(reference) {
  const res = await client.get(`/transaction/verify/${reference}`);
  return res.data.data; // { status, amount, gateway_response, ... }
}

async function listAllTransactions() {
  const transactions = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await client.get('/transaction', { params: { perPage, page } });
    const { data, meta } = res.data;
    transactions.push(...data);
    hasMore = meta.page < meta.pageCount;
    page++;
  }

  return transactions;
}

module.exports = { initializeTransaction, verifyTransaction, listAllTransactions };
