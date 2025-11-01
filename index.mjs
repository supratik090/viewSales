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

async function getLastBills(db) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return db.collection("bills").find(
    { date: { $gte: startOfDay, $lte: endOfDay } },
    { sort: { date: -1 }, limit: 5 }
  ).toArray();
}


async function getGrossProfitBreakdown(db,startOfMonth, endOfMonth ){
  // category → profit %
  const profitPercent = {
    Cake: 0.25,
    Pastry: 0.25,
    Savory: 0.3,
    Trading: 0.15,
    Other: .6,
    Others:.6 , // in case some docs use "Others"
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


async function getMonthTotalReturns(db, startOfMonth, endOfMonth) {
  const result = await db.collection('returns').aggregate([
    { $match: { returnDate: { $gte: startOfMonth, $lte: endOfMonth } } },
    {
      $group: {
        _id: null,
        monthTotalReturns: { $sum: "$deductedAmount" } // or "totalAmount" if needed
      }
    }
  ]).toArray();

  // Return total or 0 if no returns found
  return result.length ? result[0].monthTotalReturns : 0;
}

async function getMonthAdjustment(db, startOfMonth, endOfMonth) {
  const result = await db.collection('bills').aggregate([
    { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
    {
      $group: {
        _id: null,
        totalAdjustment: { $sum: "$adjustment" }
      }
    }
  ]).toArray();

  return result.length ? result[0].totalAdjustment : 0;
}




app.get('/sales', async (req, res) => {
  try {
 const { month: monthParam } = req.query;
    const { startOfMonth, endOfMonth, year, month } = getMonthRange(monthParam);

const [s1, s2, p1, p2, g1, g2, lastBills1, lastBills2,r1,r2, adj1, adj2] = await Promise.all([
  getSalesSummary(db1,startOfMonth, endOfMonth),
  getSalesSummary(db2,startOfMonth, endOfMonth),
  getPaymentModeBreakdown(db1,startOfMonth, endOfMonth),
  getPaymentModeBreakdown(db2,startOfMonth, endOfMonth),
  getGrossProfitBreakdown(db1,startOfMonth, endOfMonth),
  getGrossProfitBreakdown(db2,startOfMonth, endOfMonth),
  getLastBills(db1),
  getLastBills(db2),
   getMonthTotalReturns(db1, startOfMonth, endOfMonth), // returns total for Bangur
  getMonthTotalReturns(db2, startOfMonth, endOfMonth),
   getMonthAdjustment(db1, startOfMonth, endOfMonth),
    getMonthAdjustment(db2, startOfMonth, endOfMonth),

]);

console.log("Calling database ");

// Set selected month/year from date picker (getMonthRange)
const selectedYear = year;
const selectedMonth = month - 1; // convert 1-indexed month to 0-indexed

// Current date info
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth(); // 0-indexed

// Check if we are in the current month
const isCurrentMonth = selectedYear === currentYear && selectedMonth === currentMonth;

// Compute total days in selected month
const totalDays = new Date(selectedYear, selectedMonth + 1, 0).getDate();

// Determine days passed
let daysPassed;
if (selectedYear > currentYear || (selectedYear === currentYear && selectedMonth > currentMonth)) {
  daysPassed = 0; // future month
} else if (isCurrentMonth) {
  daysPassed = now.getDate();
} else {
  daysPassed = totalDays; // past months
}


    const avg1 = s1.monthTotal / daysPassed;
    const avg2 = s2.monthTotal / daysPassed;
    const total = s1.todaySales + s2.todaySales;
    const predicted1 = avg1 * totalDays;
    const predicted2 = avg2 * totalDays;

    const class1 = predicted1 >= target1 ? "green" : "red";
    const class2 = predicted2 >= target2 ? "green" : "red";


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



async function getLastYearMonthSales(db, startOfMonth, endOfMonth) {
  // Shift dates back by 1 year
  const startLastYear = new Date(startOfMonth);
  startLastYear.setFullYear(startLastYear.getFullYear() - 1);
  const endLastYear = new Date(endOfMonth);
  endLastYear.setFullYear(endLastYear.getFullYear() - 1);

  const data = await db.collection('past_sales').aggregate([
    { $match: { date: { $gte: startLastYear, $lte: endLastYear } } },
    {
      $group: {
        _id: { day: { $dayOfMonth: "$date" } },
        sales: { $sum: "$sales" }
      }
    },
    { $sort: { "_id.day": 1 } }
  ]).toArray();

  // Convert to a day → sales map
  const daySalesMap = {};
  data.forEach(d => {
    daySalesMap[d._id.day] = d.sales;
  });

  // Total sales last year
  const totalLastYear = data.reduce((sum, d) => sum + d.sales, 0);

  return { daySalesMap, totalLastYear };
}

const [lastYearBangur,lastYearVikhroli] = await Promise.all([
  getLastYearMonthSales(db1, startOfMonth, endOfMonth),0
]);

const chartWithLastYear = chartData.map(d => ({
  day: d.day,
  Bangur: d.Bangur,
  Vikhroli: d.Vikhroli,
  BangurLastYear: lastYearBangur.daySalesMap[d.day] || 0,
  VikhroliLastYear:0,

}));


// Create full month template
const chartFullMonth = [];
for (let day = 1; day <= totalDays; day++) {

  const lastYearBangurSales = lastYearBangur.daySalesMap[day] || 0;
  chartFullMonth.push({
    day,
    BangurLastYear: lastYearBangurSales,
  });
}
let ly1 = 0;

chartFullMonth.forEach(row => {
  ly1 += row.BangurLastYear;
});

    // Detect AJAX refresh (only send table + timestamp)
    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.send(`
        <details closed>
                      <summary>Last 5 Bills (Today)</summary>

                      <h3>Bangur Nagar</h3>
                      <table>
                        <tr>
                          <th>Time</th>
                          <th>Cart Items</th>
                          <th>Amount (₹)</th>
                          <th>Payment Mode</th>
                         </tr>
                        ${lastBills1.map(b => `
                          <tr>
                          <td>${new Date(b.date).toLocaleTimeString("en-IN", {
                                 timeZone: "Asia/Kolkata",
                                 hour: "2-digit",
                                 minute: "2-digit"
                               })}
                          </td>
               <td>
                                    ${b.cartItems.map(i => `<span>${i.name}</span>`).join(", ")}
                                 </td>
                            <td>${b.totalAmount.toLocaleString()}</td>
                            <td>${b.paymentMode}</td>
                           </tr>
                        `).join('')}
                      </table>

                      <h3>Vikhroli</h3>
                      <table>
                        <tr>
                          <th>Time</th>
                          <th>Cart Items</th>
                          <th>Amount (₹)</th>
                          <th>Payment Mode</th>
                        </tr>
                        ${lastBills2.map(b => `
                          <tr>

                            <td>${new Date(b.date).toLocaleTimeString("en-IN", {
                                   timeZone: "Asia/Kolkata",
                                   hour: "2-digit",
                                   minute: "2-digit"
                                 })}
                            </td>

                                                  <td>
                                                       ${b.cartItems.map(i => `<span>${i.name}</span>`).join(", ")}
                                                   </td>
                            <td>${b.totalAmount.toLocaleString()}</td>
                            <td>${b.paymentMode}</td>
                          </tr>
                        `).join('')}
                      </table>
                    </details>
      `);
    }

     res.send(`
         <html>
           <head>
             <title>Sales Dashboard</title>
<script>
  const SOUND_URL = "https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg";
  const audio = new Audio(SOUND_URL);
  let soundEnabled = false;
  let selectedVoice = null;

  // Last known rows
  let lastBangurRows = [];
  let lastVikhroliRows = [];

// 🎙 Pick Indian English female voice
function pickIndianFemaleVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prefer Indian English female-sounding names
  const indianEnglishFemale = voices.find(v =>
    /en-IN/i.test(v.lang) && /(Heera|female|woman|girl|F)/i.test(v.name)
  );

  // Try Google English (India)
  const googleIndianEnglish = voices.find(v =>
    /Google\s*English\s*\(India\)/i.test(v.name)
  );

  // Fallback to any English (India) voice
  const fallbackEnglishIndian = voices.find(v => /en-IN/i.test(v.lang));

  // Absolute fallback to first English voice (any accent)
  const fallbackEnglish = voices.find(v => /^en-/i.test(v.lang));

  return indianEnglishFemale || googleIndianEnglish || fallbackEnglishIndian || fallbackEnglish || voices[0];
}


  window.speechSynthesis.onvoiceschanged = function () {
    selectedVoice = pickIndianFemaleVoice();
  };

  // 🟢 Enable sound button
  window.addEventListener("load", () => {
    const btn = document.createElement("button");
    btn.textContent = "🔊 Enable Sound Alerts";
    btn.style.position = "fixed";
    btn.style.bottom = "10px";
    btn.style.right = "10px";
    btn.style.zIndex = "9999";
    btn.style.padding = "8px 12px";
    btn.style.background = "#1e90ff";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "8px";
    btn.style.cursor = "pointer";

    btn.onclick = () => {
      soundEnabled = true;
      audio.play().catch(() => {});
      const initUtter = new SpeechSynthesisUtterance("Sound alerts enabled");
      if (selectedVoice) initUtter.voice = selectedVoice;
      window.speechSynthesis.speak(initUtter);
      btn.remove();
    };
    document.body.appendChild(btn);
  });

  // 🧾 Parse one shop table (robust version)
  function parseShopTable(table) {
    const rows = [];
    if (!table) return rows;

    // Select all TRs except header ones
    const trList = table.querySelectorAll("tr");

    trList.forEach(tr => {
      const thCells = tr.querySelectorAll("th");
      if (thCells.length > 0) return; // skip header row

      const cells = tr.querySelectorAll("td");
      if (cells.length >= 4) {
        const time = cells[0].textContent.trim();
        const items =  cells[1].textContent.trim();
        const amount = cells[2].textContent.trim();
        const mode = cells[3].textContent.trim();

        if (time && amount) {
          rows.push({ time, items, amount, mode });
        }
      }
    });

    return rows;
  }


  // 🎧 Speak message
  function speak(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-IN";
    utter.pitch = 1.1;
    utter.rate = 1.0;
    if (selectedVoice) utter.voice = selectedVoice;
    speechSynthesis.speak(utter);
  }

  // 🔍 Check difference and announce
  function checkDiffAndAnnounce(shop, oldRows, newRows) {

    if (newRows.length === 0) return;

    const newEntries = newRows.filter(
      n => !oldRows.some(o => o.time === n.time && o.amount === n.amount)
    );

    if (newEntries.length > 0) {
      console.log("✨ New entries for", shop, ":", newEntries);
      newEntries.forEach(e => {
        const msg = "Sale in " + shop + ": " + e.items + ", amount " + e.amount + " rupees.";
        if (soundEnabled) {
          audio.play().catch(() => {});
          speak(msg);
        }
        console.log("🔊", msg);
      });
    }
  }

  // 🔄 Fetch and compare
  async function fetchData() {
    try {
      console.log("🔄 Refreshing sales data...");
      const res = await fetch(window.location.href, { headers: { "X-Requested-With": "XMLHttpRequest" } });
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const bangurTable = doc.querySelector("h3:nth-of-type(1) + table");


      const vikhroliTable = doc.querySelector("h3:nth-of-type(2) + table");



      const bangurRows = parseShopTable(bangurTable);
      const vikhroliRows = parseShopTable(vikhroliTable);


      checkDiffAndAnnounce("Bangur Nagar", lastBangurRows, bangurRows);
      checkDiffAndAnnounce("Vikhroli", lastVikhroliRows, vikhroliRows);

      lastBangurRows = bangurRows;
      lastVikhroliRows = vikhroliRows;

      // Update visible tables
      const oldTables = document.querySelectorAll("h3 + table");
      const newTables = doc.querySelectorAll("h3 + table");
      if (oldTables.length === newTables.length) {
        for (let i = 0; i < oldTables.length; i++) {
          oldTables[i].innerHTML = newTables[i].innerHTML;
        }
      }

    } catch (err) {
      console.error("Error refreshing data:", err);
    }
  }

  // ⏱ Initialize
  window.addEventListener("load", () => {
    const bangurTable = document.querySelector("h3:nth-of-type(1) + table");
    const vikhroliTable = document.querySelector("h3:nth-of-type(2) + table");
    if (bangurTable) lastBangurRows = parseShopTable(bangurTable);
    if (vikhroliTable) lastVikhroliRows = parseShopTable(vikhroliTable);
    setInterval(fetchData, 10000); // refresh every 10s
  });
</script>


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

            <details closed>
              <summary>Last 5 Bills (Today)</summary>

              <h3>Bangur Nagar</h3>
              <table>
                <tr>
                  <th>Time</th>
                  <th>Cart Items</th>
                  <th>Amount (₹)</th>
                  <th>Payment Mode</th>
                 </tr>
                ${lastBills1.map(b => `
                  <tr>
                  <td>${new Date(b.date).toLocaleTimeString("en-IN", {
                         timeZone: "Asia/Kolkata",
                         hour: "2-digit",
                         minute: "2-digit"
                       })}
                  </td>
       <td>
                            ${b.cartItems.map(i => `<span>${i.name}</span>`).join(", ")}
                         </td>
                    <td>${b.totalAmount.toLocaleString()}</td>
                    <td>${b.paymentMode}</td>
                   </tr>
                `).join('')}
              </table>

              <h3>Vikhroli</h3>
              <table>
                <tr>
                  <th>Time</th>
                  <th>Cart Items</th>
                  <th>Amount (₹)</th>
                  <th>Payment Mode</th>
                </tr>
                ${lastBills2.map(b => `
                  <tr>

                    <td>${new Date(b.date).toLocaleTimeString("en-IN", {
                           timeZone: "Asia/Kolkata",
                           hour: "2-digit",
                           minute: "2-digit"
                         })}
                    </td>

                                          <td>
                                               ${b.cartItems.map(i => `<span>${i.name}</span>`).join(", ")}
                                           </td>
                    <td>${b.totalAmount.toLocaleString()}</td>
                    <td>${b.paymentMode}</td>
                  </tr>
                `).join('')}
              </table>
            </details>



            <details closed>
              <summary>This Month's Sales</summary>

             <table>
               <tr>
                 <th>Location</th>
                 <th>Sales (₹)</th>
                 <th>Target (₹)</th>
                 <th>Avg/Day (₹)</th>
                 <th>Predicted (₹)</th>
                 <th>Last year(₹)</th>
                 <th>% Achieved</th>
               </tr>
               <tr class="${class1}">
                 <td>Bangur Nagar</td>
                 <td>${s1.monthTotal.toLocaleString()}</td>
                 <td>${target1.toLocaleString()}</td>
                 <td>${formatNumber(avg1)}</td>
                 <td>${formatNumber(predicted1)}</td>
                 <td>${formatNumber(ly1)}</td>
                 <td>${formatNumber((s1.monthTotal / target1) * 100, 1)}%</td>
               </tr>
               <tr class="${class2}">
                 <td>Vikhroli</td>
                 <td>${s2.monthTotal.toLocaleString()}</td>
                 <td>${target2.toLocaleString()}</td>
                 <td>${formatNumber(avg2)}</td>45000
                 <td>${formatNumber(predicted2)}</td>
                  <td>Nan</td>
                 <td>${formatNumber((s2.monthTotal / target2) * 100, 1)}%</td>
               </tr>
                 <tr style="font-weight:bold; background:#f2f2f2;">
                   <td>Total</td>
                   <td>${(s1.monthTotal + s2.monthTotal).toLocaleString()}</td>
                   <td>${(target1 + target2).toLocaleString()}</td>
                   <td>${formatNumber(avg1 + avg2)}</td>
                   <td>${formatNumber(predicted1 + predicted2)}</td>
                    <td>${formatNumber(ly1)}</td>
                   <td>${formatNumber(((s1.monthTotal + s2.monthTotal) / (target1 + target2)) * 100, 1)}%</td>
                 </tr>
             </table>
            </details>

            <details closed>
              <summary>Bangur Nagar Sales Last Year </summary>
              <table>
                <tr>
                  <th>Day</th>
                  <th>Bangur Last Year (₹)</th>
                </tr>
                ${
                  (() => {
                    let totalBangurLY = 0;

                    const rowsHtml = chartFullMonth.map(row => {
                      totalBangurLY += row.BangurLastYear;
                      return `
                        <tr>
                          <td>${row.day}</td>
                          <td>${row.BangurLastYear.toLocaleString()}</td>
                        </tr>
                      `;
                    }).join('');

                    const totalRow = `
                      <tr style="font-weight:bold; background:#f2f2f2">
                        <td>Total</td>
                        <td>${totalBangurLY.toLocaleString()}</td>
                      </tr>
                    `;

                    return rowsHtml + totalRow;
                  })()
                }
              </table>
            </details>


            <details closed>
              <summary>Daily Sales vs Last Year</summary>
              <table>
                <tr>
                  <th>Day</th>
                  <th>Bangur (₹)</th>
                  <th>Bangur Last Year (₹)</th>
                </tr>
                ${
                  (() => {
                    let totalBangur = 0;
                    let totalBangurLY = 0;

                    const rowsHtml = chartWithLastYear.map(row => {
                      totalBangur += row.Bangur;
                      totalBangurLY += row.BangurLastYear;

                      return `
                        <tr>
                          <td>${row.day}</td>
                          <td style="color:${row.Bangur > row.BangurLastYear ? 'green' : 'red'}">
                            ${row.Bangur.toLocaleString()}
                          </td>
                          <td>${row.BangurLastYear.toLocaleString()}</td>
                        </tr>
                      `;
                    }).join('');

                    // Add total row at the end
                    const totalRow = `
                      <tr style="font-weight:bold; background:#f2f2f2; color:${totalBangur > totalBangurLY ? 'green' : 'red'}">
                        <td>Total</td>
                        <td>${totalBangur.toLocaleString()}</td>
                        <td>${totalBangurLY.toLocaleString()}</td>
                      </tr>
                    `;

                    return rowsHtml + totalRow;
                  })()
                }
              </table>
            </details>




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
                    <th>Returns (₹)</th>
                   <th>Net Profit (₹)</th>
                   <th>Net %</th>
                 </tr>
                 ${
                   (() => {
                     const totalBangurProfit = g1.reduce((sum, x) => sum + (x.profit || 0), 0);
                     const totalVikhroliProfit = g2.reduce((sum, x) => sum + (x.profit || 0), 0);
                     const bangurExpense = 100000;
                     const vikhroliExpense = 70000;

                     const bangurReturns = r1;
                     const vikhroliReturns = r2;
                    const bangurAdjustment = adj1;
                    const vikhroliAdjustment = adj2;

                    const bangurNet = totalBangurProfit - bangurExpense - bangurReturns ;
                    const vikhroliNet = totalVikhroliProfit - vikhroliExpense - vikhroliReturns ;

                     const bangurNetPct = totalBangurProfit ? ((bangurNet / totalBangurProfit) * 100).toFixed(2) : 0;
                     const vikhroliNetPct = totalVikhroliProfit ? ((vikhroliNet / totalVikhroliProfit) * 100).toFixed(2) : 0;
                     const totalGross = totalBangurProfit + totalVikhroliProfit;
                     const totalExpense = bangurExpense + vikhroliExpense;
                      const totalReturns = bangurReturns + vikhroliReturns;
                     const totalNet = bangurNet + vikhroliNet;
                     const totalPct = totalGross ? ((totalNet / totalGross) * 100).toFixed(2) : 0;

                     const formatRow = (loc, gross, expense,returns, net, pct) => `
                       <tr style="color:${net < 0 ? 'red' : 'green'}; font-weight:bold;">
                         <td>${loc}</td>
                         <td>${gross.toLocaleString()}</td>
                         <td>${expense.toLocaleString()}</td>
                         <td>${returns.toLocaleString()}</td>
                         <td>${net.toLocaleString()}</td>
                         <td>${pct}%</td>
                       </tr>
                     `;

                     return `
                       ${formatRow("Bangur Nagar", totalBangurProfit, bangurExpense,bangurReturns, bangurNet, bangurNetPct)}
                       ${formatRow("Vikhroli", totalVikhroliProfit, vikhroliExpense,vikhroliReturns, vikhroliNet, vikhroliNetPct)}
                       <tr style="background:#f2f2f2; font-weight:bold; color:${totalNet < 0 ? 'red' : 'green'};">
                         <td>Total</td>
                         <td>${totalGross.toLocaleString()}</td>
                         <td>${totalExpense.toLocaleString()}</td>
                         <td>${totalReturns.toLocaleString()}</td>
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

                             // --- Add adjustment only to Cake gross sales ---
                             if (cat === "Cake") {
                               c1.grossSales += adj1 || 0;
                               c2.grossSales += adj2 || 0;
                             }

                         totalBangurGross += c1.grossSales;
                         totalBangurProfit += c1.profit;
                         totalVikhroliGross += c2.grossSales;
                         totalVikhroliProfit += c2.profit;

                            // Add adjustment ONLY for Cake
                             const adjBangur = cat === "Cake" ? adj1 : 0;
                             const adjVikhroli = cat === "Cake" ? adj2 : 0;
                             const totalAdj = adjBangur + adjVikhroli;

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



             <style>
             details {
               font-size: 14px; /* keep same as tables/body */
             }

             details summary {
               font-size: 16px; /* only summary slightly bigger */
               font-weight: bold;
               cursor: pointer;
               padding: 6px;
             }

             details[open] {
               font-size: 14px; /* prevent auto expansion effect */
             }

             </style>
           </body>
         </html>
       `);
     } catch (err) {
       console.error(err);
       res.status(500).send('Something went wrong');
     }
   });

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
