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

async function getDailySales(db) {
  const start = new Date();
  start.setDate(1); // Start of month
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setMonth(start.getMonth() + 1);
  end.setMilliseconds(-1);

  return await db.collection("bills").aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          day: { $dayOfMonth: "$date" },
          month: { $month: "$date" },
          year: { $year: "$date" },
        },
        totalSales: { $sum: "$totalAmount" }
      }
    },
    { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
  ]).toArray();
}


async function getMonthSales(db) {
  const start = new Date();
  start.setDate(1);             // Start of current month
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setMonth(start.getMonth() + 1); // First day of next month
  end.setMilliseconds(-1);           // End of current month

  const result = await db.collection("bills").aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    { $group: { _id: null, totalSales: { $sum: "$totalAmount" } } },
  ]).toArray();

  return result[0]?.totalSales || 0;
}

app.get('/sales', async (req, res) => {
  try {
    await Promise.all([client1.connect(), client2.connect()]);
    const db1 = client1.db();
    const db2 = client2.db();

    const [sales1, sales2, monthSales1, monthSales2] = await Promise.all([
      getTodaySales(db1),
      getTodaySales(db2),
      getMonthSales(db1),
      getMonthSales(db2),
    ]);

    const [dailySales1, dailySales2] = await Promise.all([
      getDailySales(db1),
      getDailySales(db2),
    ]);


    const totalSales = sales1 + sales2;
    const totalMonthSales = monthSales1 + monthSales2;

    // Monthly Targets
    const target1 = 500000;
    const target2 = 450000;

    // Days
    const daysPassed = new Date().getDate();
    const totalDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

    // Average per day
    const avg1 = monthSales1 / daysPassed;
    const avg2 = monthSales2 / daysPassed;

    // Predicted total sales (end of month)
    const predicted1 = avg1 * totalDays;
    const predicted2 = avg2 * totalDays;

    // Conditional coloring
    const class1 = predicted1 >= target1 ? "green" : "red";
    const class2 = predicted2 >= target2 ? "green" : "red";

    // Build chart data
    const chartData = [];
    const maxDays = Math.max(
      dailySales1.length ? dailySales1[dailySales1.length - 1]._id.day : 0,
      dailySales2.length ? dailySales2[dailySales2.length - 1]._id.day : 0
    );

    for (let i = 1; i <= maxDays; i++) {
      const day1 = dailySales1.find(d => d._id.day === i)?.totalSales || 0;
      const day2 = dailySales2.find(d => d._id.day === i)?.totalSales || 0;
      chartData.push({ day: i, Bangur: day1, Vikhroli: day2 });
    }


    res.send(`
      <html>
        <head>
          <title>Sales Summary</title>
          <style>
            body { font-family: Arial; margin: 2rem; }
            table { border-collapse: collapse; width: 85%; margin-bottom: 2rem; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: center; }
            th { background-color: #f2f2f2; }
            .green { background-color: #c6f6d5; }
            .red { background-color: #fed7d7; }
          </style>
        </head>
        <body>
          <h2>Today's Sales</h2>
          <table>
            <tr><th>Location</th><th>Sales (₹)</th></tr>
            <tr><td>Bangur Nagar</td><td>${sales1.toLocaleString()}</td></tr>
            <tr><td>Vikhroli</td><td>${sales2.toLocaleString()}</td></tr>
            <tr><th>Total</th><th>${totalSales.toLocaleString()}</th></tr>
          </table>

          <h2>This Month's Sales (with Prediction)</h2>
          <table>
            <tr>
              <th>Location</th>
              <th>Sales (₹)</th>
              <th>Target (₹)</th>
              <th>Average Per Day (₹)</th>
              <th>Predicted Sales (₹)</th>
            </tr>
            <tr class="${class1}">
              <td>Bangur Nagar</td>
              <td>${monthSales1.toLocaleString()}</td>
              <td>${target1.toLocaleString()}</td>
              <td>${avg1.toFixed(2).toLocaleString()}</td>
              <td>${predicted1.toFixed(2).toLocaleString()}</td>
            </tr>
            <tr class="${class2}">
              <td>Vikhroli</td>
              <td>${monthSales2.toLocaleString()}</td>
              <td>${target2.toLocaleString()}</td>
              <td>${avg2.toFixed(2).toLocaleString()}</td>
              <td>${predicted2.toFixed(2).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Total</th>
              <th>${totalMonthSales.toLocaleString()}</th>
              <th>${(target1 + target2).toLocaleString()}</th>
              <th>${((monthSales1 + monthSales2) / daysPassed).toFixed(2).toLocaleString()}</th>
              <th>${(predicted1 + predicted2).toFixed(2).toLocaleString()}</th>
            </tr>
          </table>

          <h2>Sales Per Day - Bar Chart</h2>
          <canvas id="salesChart" width="800" height="400"></canvas>
          <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
          <script>
            const ctx = document.getElementById('salesChart').getContext('2d');
            new Chart(ctx, {
              type: 'bar',
              data: {
                labels: ${JSON.stringify(chartData.map(d => d.day))},
                datasets: [
                  {
                    label: 'Bangur Nagar',
                    data: ${JSON.stringify(chartData.map(d => d.Bangur))},
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                  },
                  {
                    label: 'Vikhroli',
                    data: ${JSON.stringify(chartData.map(d => d.Vikhroli))},
                    backgroundColor: 'rgba(153, 102, 255, 0.6)',
                  }
                ]
              },
              options: { responsive: true, plugins: { legend: { position: 'top' } } }
            });
          </script>
            <h2>Sales Per Day - Table</h2>
            <table>
              <tr>
                <th>Date</th>
                <th>Bangur Nagar (₹)</th>
                <th>Vikhroli (₹)</th>
                <th>Total (₹)</th>
              </tr>
              ${chartData.map(row => {
                const total = row.Bangur + row.Vikhroli;
                let bgColor = '';
                if (total > 30000) bgColor = 'style="background-color:#90EE90"'; // green
                else if (total > 20000) bgColor = 'style="background-color:#FFFF99"'; // yellow
                else bgColor = 'style="background-color:#FFB6B6"'; // red

                return `
                  <tr ${bgColor}>
                    <td>${row.day}</td>
                    <td>${row.Bangur.toLocaleString()}</td>
                    <td>${row.Vikhroli.toLocaleString()}</td>
                    <td>${total.toLocaleString()}</td>
                  </tr>
                `;
              }).join('')}
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
