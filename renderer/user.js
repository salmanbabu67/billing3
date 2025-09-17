let categories = [];
let selectedCategory = 'all';
// User POS interface functionality
let branchData = null;
let products = [];
let offers = [];
let currentBill = {
    items: [],
    total: 0
};
let shortcutBuffer = '';
let shortcutTimeout = null;
let currentBillNo = null;

document.addEventListener('DOMContentLoaded', function () {
    // Global shortcut buffer for numeric keys
    document.addEventListener('keydown', function(e) {
        // Debug: log every keydown event and focus state
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    const isModal = document.querySelector('.custom-modal:not(.hidden)');
    console.log('[POS] keydown:', e.key, '| isInput:', isInput, '| active.id:', active && active.id, '| isModal:', !!isModal);
        if (isInput && active.id === 'searchInput') return; // Let searchInput handle its own shortcuts
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            addToShortcutBuffer(e.key);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (shortcutBuffer) {
                addProductByShortcut();
            }
        } else if (e.key === 'Escape') {
            clearShortcutBuffer();
        }
    });
    // Get currentBranch from preload API before loading data
    window.electronAPI.getCurrentBranch().then(branchCode => {
        window.currentBranch = branchCode;
        autoSyncAndLoad().then(() => {
            // Load report modal content after branch data is loaded
            loadModalTabContent('bills');
        });
    });

    // Reports modal event listeners
    const openReportsBtn = document.getElementById('openReportsBtn');
    if (openReportsBtn) openReportsBtn.addEventListener('click', openReportsModal);

    const closeReportsBtn = document.getElementById('closeReportsModal');
    if (closeReportsBtn) closeReportsBtn.addEventListener('click', closeReportsModal);

    ['bills', 'itemwise', 'billwise', 'daywise'].forEach(tab => {
        const tabBtn = document.getElementById('tab-' + tab);
        if (tabBtn) tabBtn.addEventListener('click', () => showModalTab(tab));
    });

    ['today', 'yesterday'].forEach(filter => {
        const filterBtn = document.getElementById('filter-' + filter);
        if (filterBtn) filterBtn.addEventListener('click', () => setModalFilter(filter));
    });

    const printReportsBtn = document.getElementById('printReportsBtn');
    if (printReportsBtn) printReportsBtn.addEventListener('click', printCurrentModalTab);
});

async function autoSyncAndLoad() {
    try {
        await pullSync();
    } catch (e) {
        // Ignore sync errors, still try to load data
    }
    await loadBranchData();
    setupEventHandlers();
    updateBranchInfo();
    populateProducts();
    updateBillDisplay();
}

async function loadBranchData() {
    try {
        // Get data from the main process (already loaded during login)
        // branchData may now be an array of all branches
        let allBranchData = window.branchData;
        let branchCode = window.currentBranch;
        console.log('Current branch code:', branchCode, allBranchData, window.currentUser);
        if (!branchCode && Array.isArray(allBranchData) && allBranchData.length === 1) {
            // If only one branch, use its code
            branchCode = allBranchData[0].branchDetails?.branch_code;
        }
        if (Array.isArray(allBranchData)) {
            branchData = allBranchData.find(b => b.branchDetails?.branch_code === branchCode);
            if (!branchData) {
                branchData = allBranchData[0];
            }
        } else {
            branchData = allBranchData;
        }
        // Always set window.currentBranch from branchDetails
        window.currentBranch = branchData?.branchDetails?.branch_code;
        if (!branchData || !branchData.branchDetails) {
            showMessage('Branch data is missing or corrupted. Please sync again or contact admin.', 'error');
            console.error('Branch data missing:', branchData);
            return;
        }
        console.log('Loaded branchData:', branchData, branchCode);
        products = branchData.products || [];
        console.log('Loaded products:', products);
        offers = branchData.offers || [];
        categories = branchData.categories || [];
        console.log('Loaded categories:', categories);
        selectedCategory = 'all';
        renderCategories();
        filterProductsByCategory(selectedCategory);
    } catch (error) {
        console.error('Error loading branch data:', error);
        showMessage('Failed to load branch data', 'error');
    }
}

function setupEventHandlers() {
    // Close search dropdown when clicking outside
    document.addEventListener('click', function(e) {
        const searchInput = document.getElementById('searchInput');
        const searchResults = document.getElementById('searchResults');
        if (!searchInput || !searchResults) return;
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', handleLiveSearch);
        searchInput.addEventListener('keydown', handleSearchKeydown);
    }
// Live search: show results as user types
function handleLiveSearch(e) {
    const searchTerm = e.target.value.trim().toLowerCase();
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '';
    if (!searchTerm || !products || products.length === 0) {
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div class="search-no-results" style="padding:12px;color:#888;background:#fff;border:1px solid #ccc;box-shadow:0 2px 8px rgba(0,0,0,0.07);position:absolute;width:100%;">No products found.</div>';
        return;
    }
    const matches = products.filter(p => {
        const name = p.name ? p.name.toLowerCase() : '';
        const sku = p.sku ? p.sku.toLowerCase() : '';
        return name.includes(searchTerm) || sku.includes(searchTerm);
    });
    if (matches.length === 0) {
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div class="search-no-results" style="padding:12px;color:#888;background:#fff;border:1px solid #ccc;box-shadow:0 2px 8px rgba(0,0,0,0.07);position:absolute;width:100%;">No products found.</div>';
        return;
    }
    resultsContainer.style.display = 'block';
    resultsContainer.innerHTML = '<ul class="search-dropdown" style="list-style:none;margin:0;padding:0;background:#fff;border:1px solid #1976d2;box-shadow:0 4px 16px rgba(25,118,210,0.10);position:absolute;width:100%;max-height:220px;overflow-y:auto;border-radius:8px;">' +
        matches.map(p => `<li style="padding:10px 16px;cursor:pointer;transition:background 0.2s;display:flex;justify-content:space-between;align-items:center;" onmouseover="this.style.background='#e3f2fd'" onmouseout="this.style.background='#fff'" onclick="window.selectSearchProduct('${p.product_id}')"><span style="font-weight:500;color:#1976d2;">${p.name}</span> <span style='color:#888;font-size:0.95em;'>${p.sku || ''}</span></li>`).join('') + '</ul>';
}

// Add selected product to bill and clear search
window.selectSearchProduct = function(productId) {
    const product = products.find(p => p.product_id === productId);
    if (product) {
        addProductToBill(product);
        document.getElementById('searchInput').value = '';
        document.getElementById('searchResults').style.display = 'none';
    }
}

    // Category buttons
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            filterProductsByCategory(this.dataset.category);
        });
    });

    // Report filter change
    document.querySelectorAll('input[name="reportFilter"]').forEach(radio => {
        radio.addEventListener('change', function () {
            if (this.checked) {
                loadReports();
            }
        });
    });
}

// Add Pull Sync button to the UI

function renderCategories() {
    console.log('Categories:', categories);
    const categoriesList = document.getElementById('categoriesList');
    if (!categories || categories.length === 0) {
        categoriesList.innerHTML = 'Select a branch to view categories';
        return;
    }
    categoriesList.innerHTML = '';
    // Add 'All' button
    const allBtn = document.createElement('button');
    allBtn.className = 'category-btn' + (selectedCategory === 'all' ? ' active' : '');
    allBtn.dataset.category = 'all';
    allBtn.textContent = 'All Products';
    allBtn.onclick = function () {
        selectedCategory = 'all';
        renderCategories();
        filterProductsByCategory('all');
    };
    categoriesList.appendChild(allBtn);
    // Add branch categories
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-btn' + (selectedCategory === cat ? ' active' : '');
        btn.dataset.category = cat;
        btn.textContent = cat;
        btn.onclick = function () {
            selectedCategory = cat;
            renderCategories();
            filterProductsByCategory(cat);
        };
        categoriesList.appendChild(btn);
    });
}

function handleSearchKeydown(e) {
    // Handle numeric shortcuts
    if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        addToShortcutBuffer(e.key);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (shortcutBuffer) {
            addProductByShortcut();
        } else {
            addBySearch();
        }
    } else if (e.key === 'Escape') {
        clearShortcutBuffer();
    }
}

function handleSearchInput(e) {
    // Clear shortcut buffer if user types non-numeric characters
    if (!/^\d*$/.test(e.target.value)) {
        clearShortcutBuffer();
    }
}

function addToShortcutBuffer(digit) {
    shortcutBuffer += digit;
    document.getElementById('shortcutDisplay').textContent = shortcutBuffer;

    // Clear timeout if it exists
    if (shortcutTimeout) {
        clearTimeout(shortcutTimeout);
    }

    // Set timeout to clear buffer after 1.5 seconds
    shortcutTimeout = setTimeout(() => {
        clearShortcutBuffer();
    }, 1500);
}

function clearShortcutBuffer() {
    shortcutBuffer = '';
    const shortcutDisplay = document.getElementById('shortcutDisplay');
    if (shortcutDisplay) shortcutDisplay.textContent = '0';
    if (shortcutTimeout) {
        clearTimeout(shortcutTimeout);
        shortcutTimeout = null;
    }
}

function addProductByShortcut() {
    console.log('[POS] addProductByShortcut called. Buffer:', shortcutBuffer);
    const shortcutNumber = parseInt(shortcutBuffer);
    // Debug: log all available shortcut numbers and product names
    console.log('[POS] Available shortcuts:', products.map(p => ({ shortcut_number: p.shortcut_number, name: p.name })));
    if (!shortcutNumber || shortcutNumber < 1 || !Number.isInteger(shortcutNumber)) {
        showMessage('Shortcut must be an integer ≥ 1.', 'error');
        clearShortcutBuffer();
        return;
    }
    const product = products.find(p => p.shortcut_number === shortcutNumber);
    if (product) {
        addProductToBill(product);
        clearShortcutBuffer();
        document.getElementById('searchInput').value = '';
    } else {
        showMessage(`No product found with shortcut number ${shortcutNumber}`, 'error');
        clearShortcutBuffer();
    }
}

function addBySearch() {
    const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!products || products.length === 0) {
        showMessage('Products not loaded. Please select a branch and category.', 'error');
        return;
    }
    if (!searchTerm) {
        showMessage('Please enter a search term', 'error');
        return;
    }
    const product = products.find(p => {
        const name = p.name ? p.name.toLowerCase() : '';
        const sku = p.sku ? p.sku.toLowerCase() : '';
        return name.includes(searchTerm) || sku.includes(searchTerm);
    });
    if (product) {
        addProductToBill(product);
        document.getElementById('searchInput').value = '';
    } else {
        showMessage('No product found matching your search', 'error');
    }
}

function addProductToBill(product) {
    const existingItem = currentBill.items.find(item => item.product_id === product.product_id);

    if (existingItem) {
        existingItem.qty += 1;
    } else {
        currentBill.items.push({
            product_id: product.product_id,
            name: product.name,
            price: product.price,
            qty: 1,
            total: product.price
        });
    }

    updateBillDisplay();
    showMessage(`${product.name} added to bill`, 'success');
}

function updateBillDisplay() {
    const billItemsContainer = document.getElementById('billItems');
    const billTotalElement = document.getElementById('billTotal');
    if (currentBill.items.length === 0) {
        billItemsContainer.innerHTML = '<div class="empty-state"><div>No items in bill</div></div>';
        billTotalElement.textContent = '₹0.00';
        const printBtn = document.getElementById('printBtn');
        if (printBtn) {
            printBtn.disabled = true;
            printBtn.onclick = function () {
                showMessage('Please use the Print button in the bill modal after generating the bill.', 'info');
            };
        }
        // Clear bill summary if present
        const billFooter = document.querySelector('.bill-footer');
        if (billFooter) billFooter.querySelector('.bill-summary')?.remove();
        return;
    }

    // Calculate subtotal
    const subtotal = currentBill.items.reduce((sum, item) => sum + (item.price * item.qty), 0);

    // Always get offers from the current branchData
    let discount = 0;
    let discountLabel = '';
    let branchOffers = branchData && branchData.offers ? branchData.offers : [];
    if (branchOffers.length > 0) {
        // Apply first offer with a 'discount' field
        const activeOffer = branchOffers.find(o => o.discount);
        if (activeOffer) {
            discount = subtotal * (activeOffer.discount / 100);
            discountLabel = `${activeOffer.discount}% ${activeOffer.name || 'Discount'}`;
        }
    }
    const discountedSubtotal = subtotal - discount;

    // GST calculation
    const sgst = discountedSubtotal * 0.025;
    const cgst = discountedSubtotal * 0.025;
    const grandTotal = discountedSubtotal + sgst + cgst;

    // Update display
    billItemsContainer.innerHTML = currentBill.items.map((item, index) => `
        <div class="bill-item">
            <div class="bill-item-info">
                <div class="bill-item-name">${item.name}</div>
<div class="qty-control">
                    <button class="qty-btn" onclick="updateItemQty(${index}, -1)">-</button>
                    <input type="number" class="qty-input" value="${item.qty}" min="1" onchange="setItemQty(${index}, this.value)">
                    <button class="qty-btn" onclick="updateItemQty(${index}, 1)">+</button>
                </div>
            </div>
            <div class="bill-item-controls">
                <div style="min-width: 80px; text-align: right; margin: 0 10px;">
                    ₹${(item.price * item.qty).toFixed(2)}
                </div>
                <button class="remove-btn" onclick="removeItem(${index})">Remove</button>
            </div>
        </div>
    `).join('');

    billTotalElement.textContent = `₹${grandTotal.toFixed(2)}`;
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.disabled = false;

    // Add bill summary (discount, GST, grand total)
    let billFooter = document.querySelector('.bill-footer');
    if (billFooter) {
        let summary = billFooter.querySelector('.bill-summary');
        if (!summary) {
            summary = document.createElement('div');
            summary.className = 'bill-summary';
            billFooter.appendChild(summary);
        }
        summary.innerHTML = `
            <div style="display: flex; justify-content: space-between;"><div>Subtotal:</div> <div>₹${subtotal.toFixed(2)}</div></div>
            <div style="display: flex; justify-content: space-between;"><div>Discount:</div> <div>-₹${discount.toFixed(2)} ${discountLabel ? '(' + discountLabel + ')' : ''}</div></div>
            <div style="display: flex; justify-content: space-between;"><div>SGST (2.5%):</div> <div>₹${sgst.toFixed(2)}</div></div>
            <div style="display: flex; justify-content: space-between;"><div>CGST (2.5%):</div> <div>₹${cgst.toFixed(2)}</div></div>
        `;
    }
}

function updateItemQty(index, change) {
    const item = currentBill.items[index];
    const newQty = Math.max(1, item.qty + change);
    setItemQty(index, newQty);
}

function setItemQty(index, qty) {
    const item = currentBill.items[index];
    item.qty = Math.max(1, parseInt(qty) || 1);
    item.total = item.price * item.qty;
    updateBillDisplay();
}

function removeItem(index) {
    currentBill.items.splice(index, 1);
    updateBillDisplay();
}

async function generateBill() {
    if (currentBill.items.length === 0) {
        showMessage('No items in bill to generate', 'error');
        return;
    }

    try {
        // Calculate bill fields
        const subtotal = currentBill.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let discount = 0;
        let branchOffers = branchData && branchData.offers ? branchData.offers : [];
        if (branchOffers.length > 0) {
            const activeOffer = branchOffers.find(o => o.discount);
            if (activeOffer) {
                discount = subtotal * (activeOffer.discount / 100);
            }
        }
        const discountedSubtotal = subtotal - discount;
        const sgst = discountedSubtotal * 0.025;
        const cgst = discountedSubtotal * 0.025;
        const grandTotal = discountedSubtotal + sgst + cgst;

        const now = new Date();
        // Prepare billData without bill_no (backend assigns it)
        const billData = {
            date_iso: now.toISOString().split('T')[0],
            created_at_ts: now.toISOString(),
            items: currentBill.items.map(item => ({
                product_id: item.product_id,
                name: item.name,
                qty: item.qty,
                price: item.price,
                total: item.total
            })),
            total: grandTotal,
            sgst,
            cgst,
            branchDetails: branchData?.branchDetails || branchData?.branch_details || {}
        };

        const result = await window.electronAPI.createBill(billData);

        if (result.success) {
            currentBillNo = result.billNo;
            document.getElementById('currentBillNo').textContent = currentBillNo;
            showMessage(`Bill #${currentBillNo} generated successfully`, 'success');
            // Add bill_no to billData for modal display
            const billDataWithNo = { ...billData, bill_no: result.billNo };
            showBillModal(result.billNo, billDataWithNo);
        } else {
            showMessage(result.message || 'Failed to generate bill', 'error');
        }
    } catch (error) {
        console.error('Error generating bill:', error);
        showMessage('Failed to generate bill', 'error');
    }
}

async function printBill() {
    // Printing is now only allowed from the bill modal, not directly from bill-section
    showMessage('Please use the Print button in the bill modal after generating the bill.', 'info');
}

// Move showBillModal and helpers to top-level so generateBill can call them
function showBillModal(billNo, billData) {
    // Create and show a modal with bill details and a Print button
    let modal = document.getElementById('billModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'billModal';
        modal.className = 'custom-modal';
        modal.innerHTML = `
        <div class="custom-modal-content" style="max-width:800px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h2 style="font-size:1.3rem;font-weight:700;color:#222;">Bill #${billNo}</h2>
                <button onclick="closeBillModal()" style="background:none;border:none;font-size:2rem;line-height:1;cursor:pointer;color:#888;">&times;</button>
            </div>
            <div id="billModalContent">
                ${getBillHtml(billData)}
            </div>
            <div style="margin-top:1.5rem;text-align:right;">
                <button id="printBillModalBtn" class="btn btn-success">Print</button>
            </div>
        </div>
    `;
        document.body.appendChild(modal);
    } else {
        modal.querySelector('#billModalContent').innerHTML = getBillHtml(billData);
        modal.querySelector('h2').textContent = `Bill #${billNo}`;
        modal.classList.remove('hidden');
    }
    modal.classList.remove('hidden');
    // Only allow printing once
    const printBtn = modal.querySelector('#printBillModalBtn');
    if (printBtn) {
        printBtn.disabled = false;
        printBtn.onclick = function () {
            printBtn.disabled = true;
            const billHtml = getBillHtml(billData);
            window.electronAPI.printBillHtml(billHtml).then(result => {
                if (result.success) {
                    showMessage('Bill printed successfully', 'success');
                } else {
                    showMessage(result.message || 'Print failed', 'error');
                }
                closeBillModal();
            }).catch(() => {
                showMessage('Print failed', 'error');
                closeBillModal();
            });
        };
    }
}

function closeBillModal() {
    const modal = document.getElementById('billModal');
    if (modal) {
        modal.classList.add('hidden');
        setTimeout(() => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }, 300); // allow any transition to finish
    }
}

function getBillHtml(billData) {
    console.log(billData);
    const branch = billData.branchDetails || {};
    let html = `<div class="bill-modal">
        <div class="branch-details">${branch.name || ''}</div>
        <div class="branch-address">${branch.address || branch.bill_address || ''}</div>
        <div class="branch-meta">
            ${branch.phone || ''}${branch.phone && branch.gst ? ' - ' : ''}${branch.gst || ''}<br>
            GST NO ${branch.gst || ''}<br>
            FSSAI NO ${branch.fssai || ''}<br>
            <span style="font-weight:bold;">DINE-IN</span>
        </div>
        <div class="bill-meta">
            <div>BILL NO: ${billData.bill_no || ''}</div>
            <div>DATE: ${billData.date_iso || ''}</div>
        </div>
            <div class="bill-time">TIME: ${billData.created_at_ts ? new Date(billData.created_at_ts).toLocaleTimeString() : ''}</div>
        <table>
            <thead><tr><th>ITEM NAME</th><th>QTY</th><th>PRICE</th><th>AMOUNT</th></tr></thead><tbody>`;
    billData.items.forEach(item => {
        html += `<tr><td style="text-align: justify">${item.name || item.product_id}</td><td>${item.qty}Pk</td><td>${item.price.toFixed(2)}</td><td style="text-align: end">${item.total.toFixed(2)}</td></tr>`;
    });
    html += `</tbody></table>
        <div class="bill-summary">
            <div>Total Item(s): ${billData.items.length}</div>
            <div>QTY: ${billData.items.reduce((sum, item) => sum + item.qty, 0).toFixed(3)}</div>
            <div>${billData.items.reduce((sum, item) => sum + item.total, 0).toFixed(2)}</div>
        </div>
        <div class="bill-taxes"> <div>CGST @ 2.50%</div>  <div>${billData.cgst ? billData.cgst.toFixed(2) : ''}</div></div>
        <div class="bill-taxes"> <div>SGST @ 2.50%</div>  <div>${billData.sgst ? billData.sgst.toFixed(2) : ''}</div></div>
        <div class="bill-total"><div>Total</div> <div>₹ ${billData.total ? billData.total.toFixed(2) : ''}</div></div>
        <div class="bill-footer">GST ADDED OF ALL TAXES<br><span>THANK YOU VISIT AGAIN</span></div>
    </div>`;
    return html;
}

function populateProducts() {
    // Deprecated: replaced by filterProductsByCategory
    filterProductsByCategory(selectedCategory);
}

function filterProductsByCategory(category) {
    const productsGrid = document.getElementById('productsGrid');
    productsGrid.innerHTML = '';
    let filteredProducts = products;
    if (category !== 'all') {
        filteredProducts = products.filter(p => p.category === category);
    }
    if (!filteredProducts || filteredProducts.length === 0) {
        document.getElementById('menuItemsPrompt').textContent = 'Select a branch and category to view menu items';
        productsGrid.innerHTML = '';
        return;
    } else {
        document.getElementById('menuItemsPrompt').textContent = '';
    }
    filteredProducts.forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        // Get current quantity in bill
        const billItem = currentBill.items.find(item => item.product_id === product.product_id);
        const qty = billItem ? billItem.qty : 0;
        productCard.innerHTML = `
            <div class="product-name">${product.name}</div>
            <div class="product-price">₹${product.price.toFixed(2)}</div>
            <div class="product-controls">
                <button class="qty-btn" onclick="addProductToBillById('${product.product_id}')">+</button>
                <span class="qty-counter" id="qty-counter-${product.product_id}">${qty}</span>
                <button class="qty-btn" onclick="removeProductFromBillById('${product.product_id}')">-</button>
            </div>
        `;
        productsGrid.appendChild(productCard);
    });
}

// Helper functions for plus/minus buttons
function addProductToBillById(productId) {
    const product = products.find(p => p.product_id === productId);
    if (product) {
        addProductToBill(product);
        // Update qty counter
        const billItem = currentBill.items.find(item => item.product_id === productId);
        document.getElementById(`qty-counter-${productId}`).textContent = billItem ? billItem.qty : 0;
    }
}

function removeProductFromBillById(productId) {
    const billItem = currentBill.items.find(item => item.product_id === productId);
    if (billItem) {
        if (billItem.qty > 1) {
            billItem.qty -= 1;
        } else {
            // Remove item from bill
            currentBill.items = currentBill.items.filter(item => item.product_id !== productId);
        }
        updateBillDisplay();
        // Update qty counter
        document.getElementById(`qty-counter-${productId}`).textContent = currentBill.items.find(item => item.product_id === productId)?.qty || 0;
    }
}

function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab content
    document.getElementById(`${tabName}-tab`).classList.add('active');

    // Add active class to clicked tab
    event.target.classList.add('active');
}

function showReportTab(reportType) {
    // Hide all report tab contents
    document.querySelectorAll('#reports-tab .tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all report tabs
    document.querySelectorAll('#reports-tab .tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected report tab content
    document.getElementById(`${reportType}-report`).classList.add('active');

    // Add active class to clicked tab
    event.target.classList.add('active');
}

async function loadReports() {
    const filter = document.querySelector('input[name="reportFilter"]:checked').value;

    try {
        const result = await window.electronAPI.getReports(filter);

        if (result.success) {
            populateItemWiseReport(result.data.itemWise, result.data.branchDetails);
            populateBillWiseReport(result.data.billWise, result.data.branchDetails);
            populateDaySummaryReport(result.data.dayWise, result.data.branchDetails);
        } else {
            showMessage(result.message || 'Failed to load reports', 'error');
        }
    } catch (error) {
        console.error('Error loading reports:', error);
        showMessage('Failed to load reports', 'error');
    }
}

function populateItemWiseReport(data, branchDetails) {
    const tbody = document.querySelector('#itemwiseTable tbody');
    tbody.innerHTML = '';

    data.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.name}</td>
            <td>${item.qty}</td>
            <td>₹${item.total.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });

    // Update header
    const header = document.getElementById('itemwiseHeader');
    header.innerHTML = `
        <h2>Item-wise Sale Report</h2>
        <div>
            <strong>${branchDetails.name}</strong><br>
            ${branchDetails.gst ? `GST: ${branchDetails.gst}` : ''}<br>
            ${branchDetails.fssai ? `FSSAI: ${branchDetails.fssai}` : ''}<br>
            Date: ${new Date().toLocaleDateString()}
        </div>
    `;
}

function populateBillWiseReport(data, branchDetails) {
    const tbody = document.querySelector('#billwiseTable tbody');
    tbody.innerHTML = '';

    data.forEach(bill => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${bill.bill_no}</td>
            <td>₹${bill.total.toFixed(2)}</td>
            <td>${new Date(bill.time).toLocaleString()}</td>
        `;
        tbody.appendChild(row);
    });

    // Update header
    const header = document.getElementById('billwiseHeader');
    header.innerHTML = `
        <h2>Bill-wise Sale Report</h2>
        <div>
            <strong>${branchDetails.name}</strong><br>
            ${branchDetails.gst ? `GST: ${branchDetails.gst}` : ''}<br>
            ${branchDetails.fssai ? `FSSAI: ${branchDetails.fssai}` : ''}<br>
            Date: ${new Date().toLocaleDateString()}
        </div>
    `;
}

function populateDaySummaryReport(data, branchDetails) {
    const tbody = document.querySelector('#daysummaryTable tbody');
    tbody.innerHTML = '';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${data.date}</td>
        <td>${data.total_bills}</td>
        <td>${data.total_qty}</td>
        <td>₹${data.total_sales.toFixed(2)}</td>
    `;
    tbody.appendChild(row);

    // Update header
    const header = document.getElementById('daysummaryHeader');
    header.innerHTML = `
        <h2>Day-wise Sale Summary</h2>
        <div>
            <strong>${branchDetails.name}</strong><br>
            ${branchDetails.gst ? `GST: ${branchDetails.gst}` : ''}<br>
            ${branchDetails.fssai ? `FSSAI: ${branchDetails.fssai}` : ''}<br>
            Date: ${new Date().toLocaleDateString()}
        </div>
    `;
}

function printReport(reportType) {
    // This would trigger the print functionality for the specific report
    // In a real implementation, you would send the report data to the main process for printing
    showMessage('Print functionality would be implemented here', 'info');
}

// Modal Reports Logic
function openReportsModal() {
    document.getElementById('reportsModal').classList.remove('hidden');
    // Set Bills tab as active
    document.querySelectorAll('.modal-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById('tab-bills').classList.add('active');
    showModalTab('bills');
}
function closeReportsModal() {
    document.getElementById('reportsModal').classList.add('hidden');
}
function showModalTab(tab) {
    // Highlight active tab
    ['bills', 'itemwise', 'billwise', 'daywise'].forEach(t => {
        document.getElementById('tab-' + t).classList.remove('active');
    });
    document.getElementById('tab-' + tab).classList.add('active');
    // Load tab content
    loadModalTabContent(tab);
}
function setModalFilter(filter) {
    // Highlight active filter
    ['today', 'yesterday'].forEach(f => {
        document.getElementById('filter-' + f).classList.remove('active');
    });
    document.getElementById('filter-' + filter).classList.add('active');
    // Reload current tab
    const activeTab = document.querySelector('.modal-tab.active').id.replace('tab-', '');
    loadModalTabContent(activeTab);
}
function printCurrentModalTab() {
    // Print the current modal tab content
    const content = document.getElementById('modalTabContent');
    const printWindow = window.open('', '', 'width=900,height=600');
    printWindow.document.write('<html><head><title>Print Report</title>');
    printWindow.document.write('<link rel="stylesheet" href="css/user.css">');
    printWindow.document.write('</head><body >');
    printWindow.document.write(content.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
}
function getReportHeader(reportType) {
    const details = branchData?.branch_details || {};
    console.log('Branch Details for Report Header:', branchData);
    const branchName = details.name || details.branch_code || 'Branch';
    const gst = details.gst || 'GSTIN-XXXX';
    const fssai = details.fssai || 'FSSAI-XXXX';
    const date = new Date().toLocaleDateString();
    return `<div class='report-header'>
        <div><strong>Branch:</strong> ${branchName}</div>
        <div><strong>GST:</strong> ${gst}</div>
        <div><strong>FSSAI:</strong> ${fssai}</div>
        <div><strong>Date:</strong> ${date}</div>
        <div><strong>Report:</strong> ${reportType}</div>
    </div>`;
}
function getReportFooter() {
    return `<div class='report-footer'>Thank you, visit again!</div>`;
}
function loadModalTabContent(tab) {
    // Request report data from backend
    const filter = document.querySelector('.modal-filter.active')?.id?.replace('filter-', '') || 'today';
    console.log('[DEBUG] Loading report tab:', tab, 'with filter:', filter);
    window.electronAPI.getReports(filter).then(result => {
        console.log('[DEBUG] getReports result:', result);
        if (!result.success) {
            document.getElementById('modalTabContent').innerHTML = `<div class='error'>${result.message || 'Failed to load reports'}</div>`;
            return;
        }
        let html = '';
        if (tab === 'itemwise') {
            html += getReportHeader('Item-wise Sale Report');
            html += `<table class="report-table"><thead><tr><th>S.No</th><th>Product Name</th><th>Qty Sold</th><th>Total Amount</th></tr></thead><tbody>`;
            let totalQty = 0, totalAmount = 0;
            result.data.itemWise.forEach((row, idx) => {
                html += `<tr><td>${idx + 1}</td><td>${row.name}</td><td>${row.qty}</td><td>₹${row.total.toFixed(2)}</td></tr>`;
                totalQty += row.qty;
                totalAmount += row.total;
            });
            // Add total row
            html += `<tr style='font-weight:bold;background:#f5f5f5;'><td colspan='2'>Total</td><td>${totalQty}</td><td>₹${totalAmount.toFixed(2)}</td></tr>`;
            html += `</tbody></table>`;
            html += getReportFooter();
        } else if (tab === 'billwise') {
            html += getReportHeader('Bill-wise Sale Report');
            html += `<table class="report-table"><thead><tr><th>Bill No</th><th>Items</th><th>Tax</th><th>Amount</th></tr></thead><tbody>`;
            let totalAmount = 0, totalTax = 0, totalItems = 0;
            result.data.billWise.forEach(row => {
                // Find bill details from bills array if available
                const bill = (result.data.bills || []).find(b => b.bill_no === row.bill_no) || row;
                const items = bill.items ? bill.items.length : (bill.total_items || 0);
                const tax = (bill.cgst || 0) + (bill.sgst || 0);
                html += `<tr><td>${row.bill_no}</td><td>${items}</td><td>₹${tax.toFixed(2)}</td><td>₹${row.total.toFixed(2)}</td></tr>`;
                totalAmount += row.total;
                totalTax += tax;
                totalItems += items;
            });
            // Add total row
            html += `<tr style='font-weight:bold;background:#f5f5f5;'><td>Total</td><td>${totalItems}</td><td>₹${totalTax.toFixed(2)}</td><td>₹${totalAmount.toFixed(2)}</td></tr>`;
            html += `</tbody></table>`;
            html += getReportFooter();
        } else if (tab === 'daywise') {
            html += getReportHeader('Day-wise Sale Summary');
            // Calculate total tax (CGST + SGST) for all bills
            const bills = result.data.billWise || [];
            let totalTax = 0;
            bills.forEach(bill => {
                totalTax += (bill.cgst || 0) + (bill.sgst || 0);
            });
            html += `<table class="report-table"><thead><tr><th>Date</th><th>Total Bills</th><th>Total Tax</th><th>Total Amount</th></tr></thead><tbody>`;
            html += `<tr><td>${result.data.dayWise.date}</td><td>${result.data.dayWise.total_bills}</td><td>₹${totalTax.toFixed(2)}</td><td>₹${result.data.dayWise.total_sales.toFixed(2)}</td></tr>`;
            html += `</tbody></table>`;
            html += getReportFooter();
        } else if (tab === 'bills') {
            html += getReportHeader('Bills');
            html += `<table class="report-table"><thead><tr><th>Bill No</th><th>Total</th><th>Time</th></tr></thead><tbody>`;
            result.data.billWise.forEach(row => {
                html += `<tr><td>${row.bill_no}</td><td>₹${row.total.toFixed(2)}</td><td>${new Date(row.time).toLocaleString()}</td></tr>`;
            });
            html += `</tbody></table>`;
            html += getReportFooter();
        }
        document.getElementById('modalTabContent').innerHTML = html;
    });
}

async function pullSync() {
    try {
        // Defensive: always use window.currentBranch, fallback to branchData.branchDetails.branch_code if needed
        let branchId = window.currentBranch;
        if (!branchId && window.branchData && window.branchData.branchDetails && window.branchData.branchDetails.branch_code) {
            branchId = window.branchData.branchDetails.branch_code;
        }
        if (!branchId) {
            showMessage('No branch selected for sync.', 'error');
            return;
        }
        showMessage('Syncing branch data from backend...', 'info');
        const result = await window.electronAPI.pullSync(branchId);
        if (result.success) {
            showMessage('Branch data synced from backend.', 'success');
            window.branchData = {
                branchDetails: result.branchDetails,
                products: result.products,
                offers: result.offers,
                categories: result.categories
            };
            await loadBranchData();
            populateProducts();
            updateBranchInfo();
        } else {
            showMessage(result.message || 'Sync failed', 'error');
        }
    } catch (error) {
        console.error('Pull sync error:', error);
        showMessage('Sync failed', 'error');
    }
}

function updateBranchInfo() {
    if (branchData && branchData.branchDetails) {
        document.getElementById('branchInfo').textContent = `Branch: ${branchData.branchDetails.name || branchData.branchDetails.branch_code}`;
        document.getElementById('lastSync').textContent = `Last Sync: ${new Date(branchData.branchDetails.last_sync_ts).toLocaleString()}`;
    }
}

function showMessage(text, type) {
    const message = document.getElementById('message');
    message.textContent = text;
    message.className = `message ${type}`;
    message.style.display = 'block';

    // Hide message after 5 seconds
    setTimeout(() => {
        message.style.display = 'none';
    }, 5000);
}

function logout() {
    window.showConfirmModal('Are you sure you want to logout?', () => {
        window.location.href = 'index.html';
    });
}
