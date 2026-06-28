// ==========================================
// 🏪 GOLD SHOP CORE MODULE
// Database, products, order management
// ==========================================

import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ==========================================
// 📁 DATABASE PATH
// ==========================================

const GOLD_DB_PATH = path.resolve('./database_gold.json');

// ==========================================
// 📦 DEFAULT PRODUCTS CATALOG
// ==========================================

const DEFAULT_PRODUCTS = [
    { id: 'gold_100k',   name: '💛 100k Gold',    amount: 100000,  price: 10.00,  active: true },
    { id: 'gold_500k',   name: '💛 500k Gold',    amount: 500000,  price: 45.00,  active: true },
    { id: 'gold_1m',     name: '💛 1M Gold',      amount: 1000000, price: 80.00,  active: true },
    { id: 'gold_2m',     name: '💛 2M Gold',      amount: 2000000, price: 150.00, active: true },
    { id: 'gold_5m',     name: '💛 5M Gold',      amount: 5000000, price: 350.00, active: true },
    { id: 'gold_10m',    name: '💛 10M Gold',     amount: 10000000,price: 650.00, active: true },
];

// ==========================================
// 🏪 SHOP STATE
// ==========================================

const goldDb = {
    products: [...DEFAULT_PRODUCTS],
    orders: {},
    goldStock: 0,
    config: {
        adminRoleId: process.env.GOLD_ADMIN_ROLE_ID || '',
        adminChannelId: process.env.GOLD_ADMIN_CHANNEL_ID || '',
        webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET || '',
        nextOrderNumber: 1
    }
};

let saveTimeout = null;

// ==========================================
// 💾 DATABASE PERSISTENCE
// ==========================================

function loadGoldDatabase() {
    try {
        if (fs.existsSync(GOLD_DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(GOLD_DB_PATH, 'utf8'));
            if (data.products) goldDb.products = data.products;
            if (data.orders) goldDb.orders = data.orders;
            if (data.config) goldDb.config = { ...goldDb.config, ...data.config };
            if (typeof data.goldStock === 'number') goldDb.goldStock = data.goldStock;
            console.log(`✅ Gold shop database loaded. ${Object.keys(goldDb.orders).length} orders found.`);
        } else {
            saveGoldDatabase();
            console.log('📝 New database_gold.json created with default products.');
        }
    } catch (error) {
        console.error('❌ Error loading gold database:', error.message);
    }
}

function saveGoldDatabase() {
    try {
        // Debounce saves
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            fs.writeFileSync(GOLD_DB_PATH, JSON.stringify(goldDb, null, 2), 'utf8');
        }, 200);
    } catch (error) {
        console.error('❌ Error saving gold database:', error.message);
    }
}

// ==========================================
// 📋 ORDER ID GENERATION
// ==========================================

function generateOrderId() {
    const num = goldDb.config.nextOrderNumber++;
    saveGoldDatabase();
    return `GOLD-${String(num).padStart(6, '0')}`;
}

// ==========================================
// 🏪 PUBLIC API
// ==========================================

/**
 * Initialize the gold shop system
 */
export function initGoldShop() {
    loadGoldDatabase();
    return goldDb;
}

/**
 * Get all active products
 */
export function getActiveProducts() {
    return goldDb.products.filter(p => p.active);
}

/**
 * Get all products (including inactive)
 */
export function getAllProducts() {
    return goldDb.products;
}

/**
 * Get a product by ID
 */
export function getProduct(productId) {
    return goldDb.products.find(p => p.id === productId) || null;
}

/**
 * Create a new order
 * 
 * @param {string} userId - Discord user ID
 * @param {string} userName - Discord username
 * @param {string} productId - Product ID
 * @param {string} characterName - In-game character name
 * @returns {Promise<object>} Created order
 */
export async function createOrder(userId, userName, productId, characterName) {
    const product = getProduct(productId);
    if (!product) {
        throw new Error('Produto não encontrado.');
    }
    if (!product.active) {
        throw new Error('Este produto está temporariamente indisponível.');
    }

    const orderId = generateOrderId();
    const now = new Date().toISOString();

    const order = {
        orderId,
        userId,
        userName,
        productId: product.id,
        productName: product.name,
        goldAmount: product.amount,
        price: product.price,
        status: 'pending',
        paymentId: null,
        pixQrCode: null,
        pixCopiaCola: null,
        paymentExpiresAt: null,
        characterName,
        server: 'EU',
        createdAt: now,
        paidAt: null,
        deliveredAt: null,
        deliveredBy: null,
        notes: ''
    };

    goldDb.orders[orderId] = order;
    saveGoldDatabase();

    return order;
}

/**
 * Update order with PIX payment info
 */
export function updateOrderPayment(orderId, paymentId, qrCode, qrCodeBase64) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');

    order.paymentId = paymentId;
    order.pixQrCode = qrCodeBase64;
    order.pixCopiaCola = qrCode;
    // PIX expires in 30 minutes
    order.paymentExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Mark an order as paid
 */
export function markOrderAsPaid(orderId) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status !== 'pending') return order;

    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Mark an order as delivered
 */
export function markOrderAsDelivered(orderId, deliveredBy) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status !== 'paid') {
        throw new Error('O pedido precisa ser pago antes de ser entregue.');
    }

    order.status = 'delivered';
    order.deliveredAt = new Date().toISOString();
    order.deliveredBy = deliveredBy;
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Cancel an order
 */
export function cancelOrder(orderId, reason = 'Cancelado pelo admin') {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status === 'delivered') {
        throw new Error('Não é possível cancelar um pedido já entregue.');
    }

    order.status = 'cancelled';
    order.notes = reason;
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Get order by ID
 */
export function getOrder(orderId) {
    return goldDb.orders[orderId] || null;
}

/**
 * Get orders by user ID
 */
export function getUserOrders(userId) {
    return Object.values(goldDb.orders)
        .filter(o => o.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get all pending orders (for admin panel)
 */
export function getPendingOrders() {
    return Object.values(goldDb.orders)
        .filter(o => o.status === 'paid')
        .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));
}

/**
 * Get all orders with a specific status
 */
export function getOrdersByStatus(status) {
    return Object.values(goldDb.orders)
        .filter(o => o.status === status)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get all orders
 */
export function getAllOrders() {
    return Object.values(goldDb.orders)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Update order notes
 */
export function updateOrderNotes(orderId, notes) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    order.notes = notes;
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Add or update a product in the catalog
 */
export function upsertProduct(productData) {
    const idx = goldDb.products.findIndex(p => p.id === productData.id);
    if (idx >= 0) {
        goldDb.products[idx] = { ...goldDb.products[idx], ...productData };
    } else {
        goldDb.products.push({
            id: productData.id,
            name: productData.name,
            amount: productData.amount,
            price: productData.price,
            active: true,
            ...productData
        });
    }
    saveGoldDatabase();
    return productData;
}

/**
 * Toggle product active status
 */
export function toggleProduct(productId) {
    const product = getProduct(productId);
    if (!product) throw new Error('Produto não encontrado.');
    product.active = !product.active;
    saveGoldDatabase();
    return product;
}

/**
 * Permanently delete a product from the catalog
 */
export function deleteProduct(productId) {
    const idx = goldDb.products.findIndex(p => p.id === productId);
    if (idx === -1) throw new Error('Produto não encontrado.');
    const removed = goldDb.products.splice(idx, 1)[0];
    saveGoldDatabase();
    return removed;
}

/**
 * Update a product's price
 */
export function updateProductPrice(productId, newPrice) {
    const product = getProduct(productId);
    if (!product) throw new Error('Produto não encontrado.');
    if (newPrice <= 0) throw new Error('Preço deve ser maior que zero.');
    product.price = Number(newPrice.toFixed(2));
    saveGoldDatabase();
    return product;
}

/**
 * Create a dynamic order with custom gold amount and price
 */
export function createDynamicOrder(userId, userName, goldAmount, price, characterName, server, tierLabel) {
    const orderId = generateOrderId();
    const now = new Date().toISOString();

    const order = {
        orderId,
        userId,
        userName,
        productId: 'dynamic',
        productName: `💛 ${goldAmount.toLocaleString()} Gold`,
        goldAmount,
        price: Number(price.toFixed(2)),
        status: 'pending',
        paymentId: null,
        pixQrCode: null,
        pixCopiaCola: null,
        paymentExpiresAt: null,
        characterName,
        server,
        createdAt: now,
        paidAt: null,
        deliveredAt: null,
        deliveredBy: null,
        notes: `📊 ${tierLabel}`
    };

    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Add a new product to the catalog
 */
export function addProduct(id, name, amount, price) {
    if (getProduct(id)) throw new Error('Já existe um produto com este ID.');
    if (price <= 0) throw new Error('Preço deve ser maior que zero.');
    if (amount <= 0) throw new Error('Quantidade de gold deve ser maior que zero.');

    const product = {
        id,
        name,
        amount,
        price: Number(price.toFixed(2)),
        active: true
    };
    goldDb.products.push(product);
    saveGoldDatabase();
    return product;
}

// ==========================================
// 💰 GOLD STOCK & PRICING
// ==========================================

/** Preço por unidade base (1053 gold) em cada tier */
const PRICE_TIERS = [
    { maxGold: 5000,  pricePerUnit: 18.00 },
    { maxGold: 10000, pricePerUnit: 17.00 },
    { maxGold: Infinity, pricePerUnit: 16.50 }
];

/** Unidade base de gold */
export const GOLD_UNIT = 1053;

/**
 * Get current available gold stock
 */
export function getGoldStock() {
    const stock = goldDb.goldStock || 0;
    return stock;
}

/**
 * Set available gold stock (admin only)
 */
export function setGoldStock(amount) {
    if (amount < 0) throw new Error('Estoque não pode ser negativo.');
    goldDb.goldStock = Math.floor(amount);
    saveGoldDatabase();
    return goldDb.goldStock;
}

/**
 * Deduct gold from stock after delivery
 */
export function deductStock(amount) {
    const current = getGoldStock();
    if (current < amount) throw new Error('Estoque insuficiente.');
    goldDb.goldStock = current - amount;
    saveGoldDatabase();
    return goldDb.goldStock;
}

/**
 * Calculate dynamic price based on gold amount and tier
 * 
 * Tiers:
 *   ≤ 5k gold:    R$ 18,00 per 1053 gold
 *   ≤ 10k gold:   R$ 17,00 per 1053 gold
 *   > 10k gold:   R$ 16,50 per 1053 gold
 *
 * @param {number} goldAmount - How much gold to buy
 * @returns {{ goldAmount: number, units: number, pricePerUnit: number, totalPrice: number, tier: string }}
 */
export function calculatePrice(goldAmount) {
    if (goldAmount < GOLD_UNIT) {
        throw new Error(`Mínimo de ${GOLD_UNIT.toLocaleString()} gold por compra.`);
    }

    const stock = getGoldStock();
    if (goldAmount > stock) {
        throw new Error(`Estoque insuficiente. Disponível: ${stock.toLocaleString()} gold.`);
    }

    // Find the applicable tier (< for "a partir de" semantics)
    const tier = PRICE_TIERS.find(t => goldAmount < t.maxGold);
    const pricePerUnit = tier.pricePerUnit;

    const units = goldAmount / GOLD_UNIT;
    const totalPrice = parseFloat((units * pricePerUnit).toFixed(2));

    const tierLabel = goldAmount < 5000
        ? '💵 R$ 18,00/un (< 5k)'
        : goldAmount < 10000
            ? '💰 R$ 17,00/un (5k-10k)'
            : '💎 R$ 16,50/un (> 10k)';

    return {
        goldAmount,
        units: parseFloat(units.toFixed(2)),
        pricePerUnit,
        totalPrice,
        tierLabel
    };
}

/**
 * Get pricing tiers info for display
 */
export function getPricingInfo() {
    return [
        { label: '💵 Até 5.000 gold', price: 'R$ 18,00', per: '1.053 gold' },
        { label: '💰 De 5k a 10k gold', price: 'R$ 17,00', per: '1.053 gold' },
        { label: '💎 Acima de 10k gold', price: 'R$ 16,50', per: '1.053 gold' }
    ];
}

/**
 * Get shop statistics for admin dashboard
 */
export function getShopStats() {
    const orders = Object.values(goldDb.orders);
    return {
        totalOrders: orders.length,
        pending: orders.filter(o => o.status === 'pending').length,
        paid: orders.filter(o => o.status === 'paid').length,
        delivered: orders.filter(o => o.status === 'delivered').length,
        cancelled: orders.filter(o => o.status === 'cancelled').length,
        totalRevenue: orders
            .filter(o => o.status === 'delivered')
            .reduce((sum, o) => sum + o.price, 0),
        totalGoldSold: orders
            .filter(o => o.status === 'delivered')
            .reduce((sum, o) => sum + o.goldAmount, 0),
        goldStock: getGoldStock(),
        activeProducts: goldDb.products.filter(p => p.active).length
    };
}

// ==========================================
// 📍 PANEL REFERENCE (persistent panel in Discord)
// ==========================================

/**
 * Get the stored panel reference (channelId + messageId)
 */
export function getPanelRef() {
    return goldDb.config.panelRef || null;
}

/**
 * Save the panel message reference for auto-recovery
 */
export function savePanelRef(channelId, messageId) {
    goldDb.config.panelRef = { channelId, messageId };
    saveGoldDatabase();
}

/**
 * Clear the panel reference (e.g., panel was deleted)
 */
export function clearPanelRef() {
    delete goldDb.config.panelRef;
    saveGoldDatabase();
}

export default {
    initGoldShop,
    getActiveProducts,
    getAllProducts,
    getProduct,
    createOrder,
    createDynamicOrder,
    updateOrderPayment,
    markOrderAsPaid,
    markOrderAsDelivered,
    cancelOrder,
    getOrder,
    getUserOrders,
    getPendingOrders,
    getOrdersByStatus,
    getAllOrders,
    updateOrderNotes,
    upsertProduct,
    toggleProduct,
    getShopStats,
    getPanelRef,
    savePanelRef,
    clearPanelRef,
    getGoldStock,
    setGoldStock,
    deductStock,
    calculatePrice,
    getPricingInfo,
    GOLD_UNIT
};
