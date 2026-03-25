// Finnhub API Configuration
const FINNHUB_KEY = 'd6j9dn9r01ql467ipf60d6j9dn9r01ql467ipf6g';

// State Management
const state = {
    budget: 10450.00,
    portfolio: {},
    tradeHistory: [],
    botActive: false,
    takeProfitPct: 5,
    stopLossPct: 3,
    theme: 'dark',
    currentStock: 'AAPL',
    currentPrice: 0, // Will be set by API
    sharesToTrade: 1,
    tradeType: 'buy', // 'buy' or 'sell'
    trendDays: 15
};

// Local Storage Persistence
function getUserKey() {
    const userStr = localStorage.getItem('tradingBotUser');
    if (userStr) {
        try {
            const parsed = JSON.parse(userStr);
            if (parsed.email) return `tradeBotData_${parsed.email}`;
            if (parsed.id) return `tradeBotData_${parsed.id}`;
        } catch(e) {}
    }
    return 'tradeBotData_guest';
}

function loadUserData() {
    const key = getUserKey();
    const saved = localStorage.getItem(key);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.budget = parsed.budget !== undefined ? parsed.budget : 10450.00;
            state.portfolio = parsed.portfolio || {};
            
            // Migrate old portfolio format
            for (let sym in state.portfolio) {
                if (typeof state.portfolio[sym] === 'number') {
                    state.portfolio[sym] = { shares: state.portfolio[sym], avgPrice: 150.00 }; // Fallback estimate
                }
            }
            
            state.tradeHistory = parsed.tradeHistory || [];
            state.takeProfitPct = parsed.takeProfitPct !== undefined ? parsed.takeProfitPct : 5;
            state.stopLossPct = parsed.stopLossPct !== undefined ? parsed.stopLossPct : 3;
            state.theme = parsed.theme || 'dark';
            
            if (state.theme === 'light') document.body.classList.add('light-theme');
        } catch(e) {
            console.error('Error loading user data', e);
        }
    } else {
        state.budget = 10450.00;
        state.portfolio = {};
        state.tradeHistory = [];
        state.takeProfitPct = 5;
        state.stopLossPct = 3;
        state.theme = 'dark';
    }
}

function saveUserData() {
    const key = getUserKey();
    const dataToSave = {
        budget: state.budget,
        portfolio: state.portfolio,
        tradeHistory: state.tradeHistory,
        takeProfitPct: state.takeProfitPct,
        stopLossPct: state.stopLossPct,
        theme: state.theme
    };
    localStorage.setItem(key, JSON.stringify(dataToSave));
}

const watchSymbols = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN'];
const companyNames = {
    'AAPL': 'Apple Inc.',
    'TSLA': 'Tesla Inc.',
    'MSFT': 'Microsoft Corp.',
    'NVDA': 'NVIDIA Corp.',
    'AMZN': 'Amazon.com Inc.'
};

let trustedPicks = [];

// Helper to format currency
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

// DOM Elements
const budgetEl = document.getElementById('available-budget');
const botToggle = document.getElementById('bot-toggle');
const botStatus = document.getElementById('bot-status-indicator');
const trendBtns = document.querySelectorAll('.trend-btn');
const tradeTabs = document.querySelectorAll('.trade-tab');
const sharesInput = document.getElementById('trade-shares');
const estimatedCostEl = document.getElementById('estimated-cost');
const tradeForm = document.getElementById('trade-form');
const forceTradeBtn = document.getElementById('force-optimal-trade');
const stockListEl = document.getElementById('stock-list');
const toastContainer = document.getElementById('toast-container');
const searchInput = document.getElementById('stock-search');
const currentStockNameEl = document.getElementById('current-stock-name');
const currentStockPriceEl = document.getElementById('current-stock-price');

// Chart initialization variable
let stockChart;

// ------------------------------------------------------------------
// API FETCH FUNCTIONS
// ------------------------------------------------------------------

// Fetch current quote
async function fetchQuote(symbol) {
    try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
        if (!res.ok) throw new Error('Network response was not ok');
        return await res.json();
    } catch (e) {
        console.error("Error fetching quote for", symbol, e);
        return null;
    }
}

// Fetch historical candles (Daily resolution)
async function fetchHistoricalData(symbol, days) {
    try {
        const to = Math.floor(Date.now() / 1000);
        // Include extra days to account for weekends where markets are closed
        const from = to - (days * 1.5 * 24 * 60 * 60); 
        
        const res = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
        const data = await res.json();
        
        if (data.s === 'ok') {
            // Slice the array to get exactly 'days' amount of latest points if possible
            const prices = data.c.slice(-days);
            const labels = data.t.slice(-days).map(t => new Date(t * 1000).toLocaleDateString([], {month: 'short', day: 'numeric'}));
            return { labels, data: prices };
        } else {
            throw new Error("No data returned");
        }
    } catch(e) {
        console.error("Error fetching historical data for", symbol, e);
        return { labels: [], data: [] };
    }
}

// Search utility (mocked exact match to quote for simplicity without consuming search API limits)
async function fetchCompanyProfile(symbol) {
    // If not in our manual map, just return the symbol as the name
    return companyNames[symbol] || symbol;
}

// ------------------------------------------------------------------
// RENDER FUNCTIONS
// ------------------------------------------------------------------

async function renderChart() {
    const ctx = document.getElementById('stockChart').getContext('2d');
    
    // Destroy previous chart instance if exists
    if (stockChart) {
        stockChart.destroy();
    }

    // Show loading mechanism on canvas briefly (optional, keeping it simple)
    const { labels, data } = await fetchHistoricalData(state.currentStock, state.trendDays);
    
    if (data.length === 0) {
        showToast("Historical data not available for this stock right now.", "info");
        return;
    }

    // Determine color based on trend (start vs end price in the period)
    const isUp = data[data.length - 1] >= data[0];
    const lineColor = isUp ? '#2ea043' : '#da3633';
    const bgColor = isUp ? 'rgba(46, 160, 67, 0.5)' : 'rgba(218, 54, 51, 0.5)';

    // Create gradient
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, bgColor); 
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

    stockChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${state.currentStock} Price`,
                data: data,
                borderColor: lineColor,
                backgroundColor: gradient,
                borderWidth: 2,
                pointBackgroundColor: lineColor,
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: lineColor,
                pointRadius: 2,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(13, 17, 23, 0.9)',
                    titleColor: '#8b949e',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#8b949e', font: { family: "'Inter', sans-serif", size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: {
                        color: '#8b949e',
                        font: { family: "'Inter', sans-serif" },
                        callback: function(value) { return '$' + value; }
                    }
                }
            },
            interaction: { mode: 'index', intersect: false }
        }
    });
}

// Render Watchlist
async function renderWatchlist() {
    stockListEl.innerHTML = '<p style="color: #8b949e; grid-column: 1/-1;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching live market data from Finnhub...</p>';
    trustedPicks = [];
    
    for (let sym of watchSymbols) {
        const data = await fetchQuote(sym);
        if (data && data.c) {
            trustedPicks.push({
                symbol: sym,
                name: companyNames[sym],
                price: data.c,
                change: (data.dp > 0 ? '+' : '') + data.dp.toFixed(2) + '%',
                trend: data.dp >= 0 ? 'up' : 'down'
            });
        }
    }

    stockListEl.innerHTML = trustedPicks.map(stock => `
        <div class="stock-item" onclick="selectStock('${stock.symbol}', ${stock.price}, '${stock.name}')">
            <span class="symbol">${stock.symbol}</span>
            <div style="display: flex; justify-content: space-between;">
                <span class="price">${formatCurrency(stock.price)}</span>
                <span class="change ${stock.trend === 'up' ? 'positive' : 'negative'}">
                    ${stock.change}
                </span>
            </div>
        </div>
    `).join('');
}

// Show Toast Notification
const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 3s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // wait for transition
    }, 3000);
};

// ------------------------------------------------------------------
// INTERACTION CONTROLLERS
// ------------------------------------------------------------------

// Stock Selection target
window.selectStock = async (symbol, price, name) => {
    state.currentStock = symbol;
    currentStockNameEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1rem; color: #8b949e;"></i> Loading...';
    
    // Fallbacks if only symbol provided (from search)
    if (!price) {
        const data = await fetchQuote(symbol);
        if (data && data.c && data.c !== 0) {
            price = data.c;
        } else {
            showToast('Invalid symbol or no data.', 'info');
            currentStockNameEl.textContent = `${state.currentStock}`;
            return;
        }
    }
    if (!name) name = await fetchCompanyProfile(symbol);

    state.currentPrice = price;
    currentStockNameEl.textContent = `${name} (${symbol})`;
    currentStockPriceEl.textContent = formatCurrency(price);
    
    updateEstimatedCost();
    renderChart(); // await historical data
    showToast(`Loaded live data for ${symbol}`, 'info');
};

// Update Estimated Cost
const updateEstimatedCost = () => {
    const cost = state.sharesToTrade * state.currentPrice;
    estimatedCostEl.textContent = formatCurrency(cost);
    
    // Validation visual feedback
    if (state.tradeType === 'buy' && cost > state.budget) {
        estimatedCostEl.style.color = 'var(--danger-color)';
    } else {
        estimatedCostEl.style.color = '#fff';
    }
};

// Event Listeners
trendBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        trendBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        state.trendDays = parseInt(e.target.dataset.days);
        renderChart();
    });
});

tradeTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        tradeTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        state.tradeType = e.target.dataset.type;
        document.getElementById('trade-submit-btn').textContent = state.tradeType === 'buy' ? 'Review Buy Order' : 'Review Sell Order';
        
        const btn = document.getElementById('trade-submit-btn');
        if (state.tradeType === 'buy') {
            btn.style.backgroundColor = 'var(--accent-color)';
        } else {
            btn.style.backgroundColor = 'var(--danger-color)';
        }
        updateEstimatedCost();
    });
});

sharesInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if (val > 0) {
        state.sharesToTrade = val;
        updateEstimatedCost();
    }
});

// Manual Trade Submit
tradeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cost = state.sharesToTrade * state.currentPrice;
    const sym = state.currentStock;
    
    if (state.tradeType === 'buy') {
        if (cost > state.budget) {
            showToast('Insufficient funds for this trade.', 'info');
            return;
        }
        state.budget -= cost;
        
        if (!state.portfolio[sym]) state.portfolio[sym] = 0;
        state.portfolio[sym] += state.sharesToTrade;
        
        state.tradeHistory.push({
            date: new Date().toISOString(),
            type: 'Buy',
            sym: sym,
            shares: state.sharesToTrade,
            price: cost,
            executor: 'User'
        });
        saveUserData();
        
        showToast(`Successfully bought ${state.sharesToTrade} shares of ${sym}`);
    } else {
        const ownedShares = state.portfolio[sym] ? state.portfolio[sym].shares : 0;
        if (state.sharesToTrade > ownedShares) {
            showToast(`Insufficient shares. You own ${ownedShares} shares of ${sym}.`, 'info');
            return;
        }
        
        state.budget += cost;
        state.portfolio[sym].shares -= state.sharesToTrade;
        if (state.portfolio[sym].shares === 0) delete state.portfolio[sym];
        
        state.tradeHistory.push({
            date: new Date().toISOString(),
            type: 'Sell',
            sym: sym,
            shares: state.sharesToTrade,
            price: cost,
            executor: 'User'
        });
        saveUserData();
        
        showToast(`Successfully sold ${state.sharesToTrade} shares of ${sym}`);
    }
    
    budgetEl.textContent = formatCurrency(state.budget);
});

// Bot Toggle
botToggle.addEventListener('change', (e) => {
    state.botActive = e.target.checked;
    if (state.botActive) {
        botStatus.textContent = "Bot is optimizing live trades...";
        botStatus.className = "status online";
        showToast("AutoTrader Bot activated.", "success");
    } else {
        botStatus.textContent = "Bot is currently offline";
        botStatus.className = "status offline";
        showToast("AutoTrader Bot deactivated.", "info");
    }
});

// Force Optimal Trade
forceTradeBtn.addEventListener('click', () => {
    // Simulate finding the optimal trade
    forceTradeBtn.disabled = true;
    forceTradeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing live market...';
    
    setTimeout(() => {
        if (trustedPicks.length === 0) {
            showToast("Market data still loading...", "info");
            forceTradeBtn.disabled = false;
            forceTradeBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find & Make Optimal Trade';
            return;
        }

        // Pick highest DP natively
        const optimalStock = trustedPicks.reduce((prev, current) => {
            return (parseFloat(prev.change) > parseFloat(current.change)) ? prev : current;
        });

        selectStock(optimalStock.symbol, optimalStock.price, optimalStock.name);
        const cost = optimalStock.price; // Use actual optimal stock price for cost calculation
        
        if (state.budget >= cost) {
            state.budget -= cost;
            
            const sym = optimalStock.symbol;
            if (!state.portfolio[sym]) state.portfolio[sym] = { shares: 0, avgPrice: 0 };
            const oldShares = state.portfolio[sym].shares;
            const oldAvg = state.portfolio[sym].avgPrice;
            const newAvg = oldShares === 0 ? cost : ((oldShares * oldAvg) + cost) / (oldShares + 1);
            
            state.portfolio[sym].shares += 1;
            state.portfolio[sym].avgPrice = newAvg;
            
            state.tradeHistory.push({
                date: new Date().toISOString(),
                type: 'Buy',
                sym: sym,
                shares: 1,
                price: cost,
                executor: 'Bot'
            });
            saveUserData();
            
            budgetEl.textContent = formatCurrency(state.budget);
            showToast(`Bot executed trade: Bought 1 ${sym} at ${formatCurrency(cost)}`, 'success');
        } else {
            showToast(`Bot found ${optimalStock.symbol} optimal, but insufficient funds.`, 'info');
        }
        
        forceTradeBtn.disabled = false;
        forceTradeBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find & Make Optimal Trade';
    }, 1500);
});

// Search API Form
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = e.target.value.toUpperCase().trim();
        if (query.length > 0) {
            selectStock(query, null, null); 
            e.target.value = '';
            e.target.blur();
        }
    }
});

// History Modal Logic
const historyModal = document.getElementById('history-modal');
const closeHistoryBtn = document.getElementById('close-history-modal');
const navHistoryBtn = document.getElementById('nav-history');
const historyTableBody = document.getElementById('history-table-body');

if (navHistoryBtn) {
    navHistoryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        renderHistoryModal();
        historyModal.style.display = 'flex';
    });
}
if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
        historyModal.style.display = 'none';
    });
}
window.addEventListener('click', (e) => {
    if (e.target === historyModal) {
        historyModal.style.display = 'none';
    }
});

function renderHistoryModal() {
    if (!historyTableBody) return;
    historyTableBody.innerHTML = '';
    
    if (state.tradeHistory.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #8b949e; padding: 20px;">No trading history found.</td></tr>';
        return;
    }
    
    // Reverse array to show newest first
    const reversed = [...state.tradeHistory].reverse();
    
    reversed.forEach(trade => {
        const d = new Date(trade.date);
        const formatTime = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        let typeHtml = `<span class="${trade.type === 'Buy' ? 'positive' : 'negative'}">${trade.type}</span>`;
        let executorHtml = trade.executor === 'Bot' ? '<span style="color:var(--accent-color)"><i class="fa-solid fa-robot"></i> Bot</span>' : '<i class="fa-solid fa-user"></i> User';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatTime}</td>
            <td>${executorHtml}</td>
            <td>${typeHtml}</td>
            <td>${trade.shares}x ${trade.sym}</td>
            <td>${formatCurrency(trade.price)}</td>
        `;
        historyTableBody.appendChild(tr);
    });
}

// Settings Panel Logic
const settingsPanel = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');
const navSettingsBtn = document.getElementById('nav-settings');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsLogoutBtn = document.getElementById('settings-logout-btn');
const settingsBotToggle = document.getElementById('settings-bot-toggle');
const themeDarkBtn = document.getElementById('theme-dark-btn');
const themeLightBtn = document.getElementById('theme-light-btn');
const settingsTpInput = document.getElementById('settings-tp-input');
const settingsSlInput = document.getElementById('settings-sl-input');

if (navSettingsBtn) {
    navSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Sync inputs
        if (settingsBotToggle) settingsBotToggle.checked = state.botActive;
        if (settingsTpInput) settingsTpInput.value = state.takeProfitPct;
        if (settingsSlInput) settingsSlInput.value = state.stopLossPct;
        
        if (state.theme === 'light') {
            if (themeLightBtn) themeLightBtn.classList.add('active');
            if (themeDarkBtn) themeDarkBtn.classList.remove('active');
        } else {
            if (themeDarkBtn) themeDarkBtn.classList.add('active');
            if (themeLightBtn) themeLightBtn.classList.remove('active');
        }
        
        // Fill email if possible
        const user = localStorage.getItem('tradingBotUser');
        if (user) {
            try {
                const parsed = JSON.parse(user);
                const emailInput = document.querySelector('.settings-section input[type="email"]');
                if (emailInput && parsed.email) emailInput.value = parsed.email;
            } catch(e) {}
        }

        settingsPanel.classList.add('open');
        settingsOverlay.classList.add('open');
    });
}

const closeSettings = () => {
    if (settingsPanel) settingsPanel.classList.remove('open');
    if (settingsOverlay) settingsOverlay.classList.remove('open');
};

if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
if (settingsOverlay) settingsOverlay.addEventListener('click', closeSettings);

if (settingsLogoutBtn) {
    settingsLogoutBtn.addEventListener('click', () => {
        localStorage.removeItem('tradingBotUser');
        window.location.href = 'login.html';
    });
}

if (settingsBotToggle) {
    settingsBotToggle.addEventListener('change', (e) => {
        // Dispatch to original handler
        botToggle.checked = e.target.checked;
        botToggle.dispatchEvent(new Event('change'));
    });
}

if (themeDarkBtn) {
    themeDarkBtn.addEventListener('click', () => {
        state.theme = 'dark';
        document.body.classList.remove('light-theme');
        themeDarkBtn.classList.add('active');
        themeLightBtn.classList.remove('active');
        saveUserData();
    });
}
if (themeLightBtn) {
    themeLightBtn.addEventListener('click', () => {
        state.theme = 'light';
        document.body.classList.add('light-theme');
        themeLightBtn.classList.add('active');
        themeDarkBtn.classList.remove('active');
        saveUserData();
    });
}
if (settingsTpInput) {
    settingsTpInput.addEventListener('change', (e) => {
        state.takeProfitPct = parseFloat(e.target.value) || 5;
        saveUserData();
    });
}
if (settingsSlInput) {
    settingsSlInput.addEventListener('change', (e) => {
        state.stopLossPct = parseFloat(e.target.value) || 3;
        saveUserData();
    });
}

// Background Watcher for Stop-Loss and Take-Profit
setInterval(async () => {
    if (!state.botActive) return;
    
    for (let sym in state.portfolio) {
        const position = state.portfolio[sym];
        if (!position || position.shares === 0) continue;
        
        try {
            let price = state.currentPrice;
            if (sym !== state.currentStock) {
                const data = await fetchStockData(sym);
                if (data && data.c) price = data.c;
            }
            if (!price) continue;
            
            const gainPct = ((price - position.avgPrice) / position.avgPrice) * 100;
            
            let sellReason = null;
            if (gainPct >= state.takeProfitPct) {
                sellReason = `Take-Profit (+${gainPct.toFixed(2)}%)`;
            } else if (gainPct <= -state.stopLossPct) {
                sellReason = `Stop-Loss (${gainPct.toFixed(2)}%)`;
            }
            
            if (sellReason) {
                const sharesToSell = position.shares;
                const totalValue = sharesToSell * price;
                state.budget += totalValue;
                delete state.portfolio[sym];
                
                state.tradeHistory.push({
                    date: new Date().toISOString(),
                    type: 'Sell',
                    sym: sym,
                    shares: sharesToSell,
                    price: price,
                    executor: 'Bot'
                });
                saveUserData();
                
                showToast(`Bot auto-sold ${sharesToSell} ${sym}: ${sellReason}`, 'success');
                if (sym === state.currentStock) updateDashboard();
                if (document.getElementById('budget-display')) document.getElementById('budget-display').textContent = formatCurrency(state.budget);
            }
        } catch(e) { console.warn("Auto-trade error", e); }
    }
}, 10000); // Check every 10 seconds

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in (from Supabase code)
    const user = localStorage.getItem('tradingBotUser');
    if (user) {
        try {
            const parsed = JSON.parse(user);
            showToast(`Welcome back, ${parsed.email || 'Trader'}!`);
            
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.style.display = 'block';
                logoutBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    localStorage.removeItem('tradingBotUser');
                    window.location.href = 'login.html';
                });
            }
        } catch(e) {}
    }
    
    // Load persisted state
    loadUserData();
    budgetEl.textContent = formatCurrency(state.budget);
    
    // Start fetching Data
    renderWatchlist().then(() => {
        // Load default initial stock (AAPL)
        selectStock(state.currentStock, trustedPicks[0]?.price || 175.40, companyNames[state.currentStock]);
    });
});
