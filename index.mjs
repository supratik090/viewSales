// index.js
import express from 'express';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const client1 = new MongoClient(process.env.MONGO_URI_1);
const client2 = new MongoClient(process.env.MONGO_URI_2);

async function getTodaySales(db) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const result = await db.collection('bills').aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    { $group: { _id: null, totalSales: { $sum: "$totalAmount" } } }
  ]).toArray();

  return result[0]?.totalSales || 0;
}

app.get('/', (req, res) => {
  res.redirect('/sales');
});

app.get('/sales', async (req, res) => {
  try {
    await Promise.all([client1.connect(), client2.connect()]);

    const db1 = client1.db();
    const db2 = client2.db();

    const [sales1, sales2] = await Promise.all([
      getTodaySales(db1),
      getTodaySales(db2)
    ]);

    const totalSales = sales1 + sales2;

    res.send(`
      <html>
        <head>
          <title>Sales Summary</title>
          <style>
            body { font-family: Arial; margin: 2rem; }
            table { border-collapse: collapse; width: 50%; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h2>Today's Sales</h2>
          <table>
            <tr><th>Location</th><th>Sales (₹)</th></tr>
            <tr><td>Bangur Nagar</td><td>${sales1}</td></tr>
            <tr><td>Vikhroli</td><td>${sales2}</td></tr>
            <tr><th>Total</th><th>${totalSales}</th></tr>
          </table>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
