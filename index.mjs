import express from 'express';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const client1 = new MongoClient(process.env.MONGO_URI_1);
const client2 = new MongoClient(process.env.MONGO_URI_2);

// Targets from ENV
const target1 = Number(process.env.TARGET_BANGUR) || 500000;
const target2 = Number(process.env.TARGET_VIKHROLI) || 450000;

function formatNumber(value, decimals = 2) {
  return Number(value.toFixed(decimals)).toLocaleString();
}

async function getGrossProfitBreakdown(db,startOfMonth, endOfMonth ){
  // category → profit %
  const profitPercent = {
    Cake: 0.25,
    Pastry: 0.25,
    Savory: 0.3,
    Trading: 0.15,
    Other: 0.6,
    Others: 0.6, // in case some docs use "Others"
  };



  return db.collection("bills").aggregate([
    { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $unwind: "$cartItems" },
    {
      $group: {
        _id: "$cartItems.category",
        grossSales: {
          $sum: { $multiply: ["$cartItems.price", "$cartItems.quantity"] }
        }
      }
    },
    // Look up category-specific % from the JS object we embedded as a literal
    {
      $addFields: {
        profitPercent: {
          $ifNull: [
            { $getField: { field: "$_id", input: { $literal: profitPercent } } },
            0.3 // default if category not in map
          ]
        }
      }
    },
    { $addFields: { profit: { $multiply: ["$grossSales", "$profitPercent"] } } },
    { $sort: { grossSales: -1 } }
  ]).toArray();
}


async function getSalesSummary(db,startOfMonth, endOfMonth) {
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));



  // Fetch both daily and monthly in one go
  const data = await db.collection('bills').aggregate([
    { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
    {
      $group: {
        _id: {
          day: { $dayOfMonth: "$date" },
          isToday: {
            $cond: [
              {
                $and: [
                  { $gte: ["$date", startOfDay] },
                  { $lte: ["$date", endOfDay] }
                ]
              }, true, false
            ]
          }
        },
        totalSales: { $sum: "$totalAmount" }
      }
    },
    { $sort: { "_id.day": 1 } }
  ]).toArray();

  // Split into daily sales and today's total
  let todaySales = 0;
  let dailySales = [];
  let monthTotal = 0;

  data.forEach(d => {
    monthTotal += d.totalSales;
    if (d._id.isToday) todaySales += d.totalSales;
    dailySales.push({ day: d._id.day, totalSales: d.totalSales });
  });

  return { todaySales, monthTotal, dailySales };
}

async function getPaymentModeBreakdown(db,startOfMonth, endOfMonth) {


  return await db.collection("bills").aggregate([
    { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
    {
      $group: {
        _id: "$paymentMode",
        totalSales: { $sum: "$totalAmount" }
      }
    },
    { $sort: { totalSales: -1 } }
  ]).toArray();
}




await Promise.all([client1.connect(), client2.connect()]);
const db1 = client1.db();
const db2 = client2.db();

function getMonthRange(monthParam) {
  let year, month;
  if (monthParam) {
    [year, month] = monthParam.split("-").map(Number); // e.g. "2025-08"
    month = month - 1; // JS Date month is 0-indexed
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  }

  const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return { startOfMonth, endOfMonth, year, month: month + 1 };
}


app.get('/sales', async (req, res) => {
  try {
 const { month: monthParam } = req.query;
    const { startOfMonth, endOfMonth, year, month } = getMonthRange(monthParam);

const [s1, s2, p1, p2, g1, g2] = await Promise.all([
  getSalesSummary(db1,startOfMonth, endOfMonth),
  getSalesSummary(db2,startOfMonth, endOfMonth),
  getPaymentModeBreakdown(db1,startOfMonth, endOfMonth),
  getPaymentModeBreakdown(db2,startOfMonth, endOfMonth),
  getGrossProfitBreakdown(db1,startOfMonth, endOfMonth),
  getGrossProfitBreakdown(db2,startOfMonth, endOfMonth)
]);


    const daysPassed = new Date().getDate();
    const totalDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

    const avg1 = s1.monthTotal / daysPassed;
    const avg2 = s2.monthTotal / daysPassed;
    const predicted1 = avg1 * totalDays;
    const predicted2 = avg2 * totalDays;

    const class1 = target1  >=predicted1  ? "green" : "red";
    const class2 = target2 >=predicted2  ? "green" : "red";

    // Merge daily sales by day
    const chartData = [];
    const maxDay = Math.max(
      s1.dailySales.length ? s1.dailySales[s1.dailySales.length - 1].day : 0,
      s2.dailySales.length ? s2.dailySales[s2.dailySales.length - 1].day : 0
    );

    for (let i = 1; i <= maxDay; i++) {
      const day1 = s1.dailySales.find(d => d.day === i)?.totalSales || 0;
      const day2 = s2.dailySales.find(d => d.day === i)?.totalSales || 0;
      chartData.push({ day: i, Bangur: day1, Vikhroli: day2 });
    }

     res.send(`
         <html>
           <head>
             <title>Sales Dashboard</title>
             <style>
               body { font-family: Arial; margin: 2rem; }
               table { border-collapse: collapse; width: 90%; margin-bottom: 2rem; }
               th, td { border: 1px solid #ddd; padding: 12px; text-align: center; }
               th { background-color: #f2f2f2; }
               .green { background-color: #c6f6d5; }
               .red { background-color: #fed7d7; }
               summary { font-size: 18px; font-weight: bold; cursor: pointer; padding: 6px; }
             </style>
           </head>
           <body>
           <form method="GET" action="/sales" style="margin-bottom:20px;">
             <label for="month">Select Month: </label>
             <input type="month" id="month" name="month" value="${year}-${String(month).padStart(2, '0')}" />
             <button type="submit">Go</button>
           </form>

            <h2>Today's Sales</h2>
            <table style="width:60%; border-collapse:collapse; margin:15px 0; font-family:Arial, sans-serif; font-size:14px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
  <thead>
    <tr style="background:#f2f2f2; color:#333; text-align:left;">
      <th style="padding:10px;">Location</th>
      <th style="padding:10px; text-align:right;">Sales (₹)</th>
    </tr>
  </thead>

              <tbody>
                <tr style="background:#f9f9f9;">
                  <td style="padding:10px;">Bangur Nagar</td>
                  <td style="padding:10px; text-align:right;">${s1.todaySales.toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="padding:10px;">Vikhroli</td>
                  <td style="padding:10px; text-align:right;">${s2.todaySales.toLocaleString()}</td>
                </tr>
                <tr style="font-weight:bold; background:#eaf7ea;">
                  <td style="padding:10px;">Total</td>
                  <td style="padding:10px; text-align:right;">${(s1.todaySales + s2.todaySales).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>


             <h2>This Month's Sales</h2>
             <table>
               <tr>
                 <th>Location</th>
                 <th>Sales (₹)</th>
                 <th>Target (₹)</th>
                 <th>Avg/Day (₹)</th>
                 <th>Predicted (₹)</th>
                 <th>% Achieved</th>
               </tr>
               <tr class="${class1}">
                 <td>Bangur Nagar</td>
                 <td>${s1.monthTotal.toLocaleString()}</td>
                 <td>${target1.toLocaleString()}</td>
                 <td>${formatNumber(avg1)}</td>
                 <td>${formatNumber(predicted1)}</td>
                 <td>${formatNumber((s1.monthTotal / target1) * 100, 1)}%</td>
               </tr>
               <tr class="${class2}">
                 <td>Vikhroli</td>
                 <td>${s2.monthTotal.toLocaleString()}</td>
                 <td>${target2.toLocaleString()}</td>
                 <td>${formatNumber(avg2)}</td>
                 <td>${formatNumber(predicted2)}</td>
                 <td>${formatNumber((s2.monthTotal / target2) * 100, 1)}%</td>
               </tr>
                 <tr style="font-weight:bold; background:#f2f2f2;">
                   <td>Total</td>
                   <td>${(s1.monthTotal + s2.monthTotal).toLocaleString()}</td>
                   <td>${(target1 + target2).toLocaleString()}</td>
                   <td>${formatNumber(avg1 + avg2)}</td>
                   <td>${formatNumber(predicted1 + predicted2)}</td>
                   <td>${formatNumber(((s1.monthTotal + s2.monthTotal) / (target1 + target2)) * 100, 1)}%</td>
                 </tr>
             </table>

             <details>
               <summary>Sales Per Day - Bar Chart</summary>
               <canvas id="salesChart" width="800" height="400"></canvas>
               <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
               <script>
                 new Chart(document.getElementById('salesChart').getContext('2d'), {
                   type: 'bar',
                   data: {
                     labels: ${JSON.stringify(chartData.map(d => d.day))},
                     datasets: [
                       {
                         label: 'Bangur Nagar',
                         data: ${JSON.stringify(chartData.map(d => d.Bangur))},
                         backgroundColor: 'rgba(75, 192, 192, 0.6)'
                       },
                       {
                         label: 'Vikhroli',
                         data: ${JSON.stringify(chartData.map(d => d.Vikhroli))},
                         backgroundColor: 'rgba(153, 102, 255, 0.6)'
                       }
                     ]
                   },
                   options: { responsive: true, plugins: { legend: { position: 'top' } } }
                 });
               </script>
             </details>

             <details>
               <summary>Sales Per Day - Table</summary>
               <table>
                 <tr><th>Day</th><th>Bangur (₹)</th><th>Vikhroli (₹)</th><th>Total (₹)</th></tr>
                 ${chartData.map(row => {
                   const total = row.Bangur + row.Vikhroli;
                   let bgColor = '';
                   if (total > 30000) bgColor = 'style="background-color:#90EE90"';
                   else if (total > 24100) bgColor = 'style="background-color:#FFFF99"';
                   else bgColor = 'style="background-color:#FFB6B6"';


                    let bgColorMB = '';
                   if (row.Bangur > 14200) bgColorMB = 'style="background-color:#90EE90"';
                   else  bgColorMB = 'style="background-color:#FFB6B6"';

                    let bgColorMV = '';
                   if (row.Vikhroli > 9900) bgColorMV = 'style="background-color:#90EE90"';
                   else  bgColorMV = 'style="background-color:#FFB6B6"';


                   return `
                     <tr >
                       <td>${row.day}</td>
                       <td ${bgColorMB}>${row.Bangur.toLocaleString()}</td>
                       <td ${bgColorMV}>${row.Vikhroli.toLocaleString()}</td>
                       <td ${bgColor} >${total.toLocaleString()}</td>
                     </tr>
                   `;
                 }).join('')}
               </table>
             </details>

             <details>
                            <summary>Sales Breakdown by Payment Mode </summary>

             <table>
               <tr>
                 <th>Payment Mode</th>
                 <th>Bangur Nagar (₹)</th>
                 <th>Vikhroli (₹)</th>
                 <th>Total (₹)</th>
               </tr>
               ${[...new Set([...p1.map(x => x._id), ...p2.map(x => x._id)])]
                 .map(mode => {
                   const val1 = p1.find(x => x._id === mode)?.totalSales || 0;
                   const val2 = p2.find(x => x._id === mode)?.totalSales || 0;
                   return `
                     <tr>
                       <td>${mode}</td>
                       <td>${val1.toLocaleString()}</td>
                       <td>${val2.toLocaleString()}</td>
                       <td>${(val1 + val2).toLocaleString()}</td>
                     </tr>`;
                 }).join('')}
             </table>
             </details>

             <details>
               <summary>Net Profit</summary>
               <table>
                 <tr>
                   <th>Location</th>
                   <th>Gross Profit (₹)</th>
                   <th>Expense (₹)</th>
                   <th>Net Profit (₹)</th>
                   <th>Net %</th>
                 </tr>
                 ${
                   (() => {
                     const totalBangurProfit = g1.reduce((sum, x) => sum + (x.profit || 0), 0);
                     const totalVikhroliProfit = g2.reduce((sum, x) => sum + (x.profit || 0), 0);
                     const bangurExpense = 105000;
                     const vikhroliExpense = 74000;
                     const bangurNet = totalBangurProfit - bangurExpense;
                     const vikhroliNet = totalVikhroliProfit - vikhroliExpense;
                     const bangurNetPct = totalBangurProfit ? ((bangurNet / totalBangurProfit) * 100).toFixed(2) : 0;
                     const vikhroliNetPct = totalVikhroliProfit ? ((vikhroliNet / totalVikhroliProfit) * 100).toFixed(2) : 0;
                     const totalGross = totalBangurProfit + totalVikhroliProfit;
                     const totalExpense = bangurExpense + vikhroliExpense;
                     const totalNet = bangurNet + vikhroliNet;
                     const totalPct = totalGross ? ((totalNet / totalGross) * 100).toFixed(2) : 0;

                     const formatRow = (loc, gross, expense, net, pct) => `
                       <tr style="color:${net < 0 ? 'red' : 'green'}; font-weight:bold;">
                         <td>${loc}</td>
                         <td>${gross.toLocaleString()}</td>
                         <td>${expense.toLocaleString()}</td>
                         <td>${net.toLocaleString()}</td>
                         <td>${pct}%</td>
                       </tr>
                     `;

                     return `
                       ${formatRow("Bangur Nagar", totalBangurProfit, bangurExpense, bangurNet, bangurNetPct)}
                       ${formatRow("Vikhroli", totalVikhroliProfit, vikhroliExpense, vikhroliNet, vikhroliNetPct)}
                       <tr style="background:#f2f2f2; font-weight:bold; color:${totalNet < 0 ? 'red' : 'green'};">
                         <td>Total</td>
                         <td>${totalGross.toLocaleString()}</td>
                         <td>${totalExpense.toLocaleString()}</td>
                         <td>${totalNet.toLocaleString()}</td>
                         <td>${totalPct}%</td>
                       </tr>
                     `;
                   })()
                 }
               </table>
             </details>

             <details>
               <summary>Gross Profit Calculator (This Month)</summary>
               <table>
                 <tr>
                   <th>Category</th>
                   <th>Bangur Nagar (₹)</th>
                   <th>Gross Bangur Nagar (₹)</th>
                   <th>Vikhroli (₹)</th>
                   <th>Gross Vikhroli (₹)</th>
                   <th>Total (₹)</th>
                   <th>Gross Total (₹)</th>
                 </tr>
                 ${
                   (() => {
                     let totalBangurGross = 0, totalBangurProfit = 0;
                     let totalVikhroliGross = 0, totalVikhroliProfit = 0;

                     const rows = [...new Set([...g1.map(x => x._id), ...g2.map(x => x._id)])]
                       .map(cat => {
                         const c1 = g1.find(x => x._id === cat) || { grossSales: 0, profit: 0 };
                         const c2 = g2.find(x => x._id === cat) || { grossSales: 0, profit: 0 };

                         totalBangurGross += c1.grossSales;
                         totalBangurProfit += c1.profit;
                         totalVikhroliGross += c2.grossSales;
                         totalVikhroliProfit += c2.profit;

                         return `
                           <tr>
                             <td>${cat}</td>
                             <td>${c1.grossSales.toLocaleString()}</td>
                             <td>${c1.profit.toLocaleString()}</td>
                             <td>${c2.grossSales.toLocaleString()}</td>
                             <td>${c2.profit.toLocaleString()}</td>
                             <td>${(c1.grossSales + c2.grossSales).toLocaleString()}</td>
                             <td>${(c1.profit + c2.profit).toLocaleString()}</td>
                           </tr>
                         `;
                       }).join('');

                     const grandGross = totalBangurGross + totalVikhroliGross;
                     const grandProfit = totalBangurProfit + totalVikhroliProfit;

                     const totalsRow = `
                       <tr style="font-weight:bold; background:#f2f2f2">
                         <td>Total</td>
                         <td>${totalBangurGross.toLocaleString()}</td>
                         <td>${totalBangurProfit.toLocaleString()}</td>
                         <td>${totalVikhroliGross.toLocaleString()}</td>
                         <td>${totalVikhroliProfit.toLocaleString()}</td>
                         <td>${grandGross.toLocaleString()}</td>
                         <td>${grandProfit.toLocaleString()}</td>
                       </tr>
                     `;
                     return rows + totalsRow;
                   })()
                 }
               </table>
             </details>

             <p><i>Last updated: ${new Date().toLocaleString()}</i></p>
           </body>
         </html>
       `);
     } catch (err) {
       console.error(err);
       res.status(500).send('Something went wrong');
     }
   });

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
