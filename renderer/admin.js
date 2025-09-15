// Admin dashboard functionality
let branchData = null;
let products = [];
let offers = [];
let categories = ['Food', 'Beverages', 'Snacks', 'Other'];
let branches = [];
let allBranches = [];
let selectedBranchCode = '';
// Loads products, offers, and categories for the selected branch and updates UI
async function loadBranchScopedData() {
    if (!selectedBranchCode) return;
    try {
        // Always load categories and offers from the first branch (global)
        const firstBranchCode = allBranches[0]?.branch_code || selectedBranchCode;
        const result = await window.electronAPI.getBranchData(firstBranchCode);
        if (result.success && result.data) {
            branchData = result.data;
            products = branchData.products || [];
            // Load categories and offers globally from the first branch
            categories = branchData.categories || categories;
            offers = branchData.offers || [];
            // Update UI tables
            populateProductsTable();
            populateOffersTable();
            populateCategories();
        } else {
            showMessage(result.message || 'Failed to load branch data', 'error');
        }
    } catch (error) {
        console.error('Error loading branch data:', error);
        showMessage('Failed to load branch data', 'error');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Load initial data
    loadBranchData();

    // Set up form handlers
    setupBranchForm();
    setupProductHandlers();
    setupOfferHandlers();

    // Update UI
    updateBranchInfo();
    loadAllBranches().then(async () => {
        await loadAllProductsForAdmin();
        console.log('Loaded products:', products); // Debug log to verify products array
        populateProductsTable();
    });
    populateCategories();
});

async function loadBranchData() {
    try {
        // Get data from the main process (already loaded during login)
        branchData = window.branchData || {};
        products = branchData.products || [];
        offers = branchData.offers || [];

        // Populate forms
        populateBranchForm();
        populateProductsTable();
        populateOffersTable();

    } catch (error) {
        console.error('Error loading branch data:', error);
        showMessage('Failed to load branch data', 'error');
    }
}

async function loadAllBranches() {
    try {
        // Load all branches from the data directory
        const result = await window.electronAPI.getAllBranches();
        if (result.success) {
            allBranches = result.branches;
            populateBranchDropdown();
            populateBranchFilter();
            populateBranchesTable();
            const exists = allBranches.find(b => b.branch_code === selectedBranchCode);
            if (!exists) {
                const br001 = allBranches.find(b => b.branch_code === 'BR001');
                selectedBranchCode = br001 ? 'BR001' : (allBranches[0]?.branch_code || '');
            }
            if (selectedBranchCode) {
                await loadBranchScopedData();
            }
        } else {
            console.error('Error loading branches:', result.message);
            // Fallback to empty array
            allBranches = [];
        }
    } catch (error) {
        console.error('Error loading branches:', error);
        allBranches = [];
    }
}

function populateBranchDropdown() {
    const select = document.getElementById('productBranch');
    select.innerHTML = '<option value="">Select Branch</option>';

    allBranches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.branch_code;
        option.textContent = `${branch.branch_code} - ${branch.name}`;
        select.appendChild(option);
    });
    select.onchange = function() {
        selectedBranchCode = this.value;
    };
}

function populateBranchFilter() {
    const select = document.getElementById('branchFilter');
    select.innerHTML = '<option value="">All Branches</option>';

    allBranches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.branch_code;
        option.textContent = `${branch.branch_code} - ${branch.name}`;
        select.appendChild(option);
    });
    select.onchange = () => filterProductsByBranch();
}

function populateBranchesTable() {
    const tbody = document.getElementById('branchesTableBody');
    tbody.innerHTML = '';
    allBranches.forEach(branch => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${branch.branch_code}</td>
            <td contenteditable="false" data-field="name" data-code="${branch.branch_code}">${branch.name || ''}</td>
            <td contenteditable="false" data-field="gst" data-code="${branch.branch_code}">${branch.gst || ''}</td>
            <td contenteditable="false" data-field="fssai" data-code="${branch.branch_code}">${branch.fssai || ''}</td>
            <td contenteditable="false" data-field="phone" data-code="${branch.branch_code}">${branch.phone || ''}</td>
            <td contenteditable="false" data-field="email" data-code="${branch.branch_code}">${branch.email || ''}</td>
            <td contenteditable="false" data-field="bill_address" data-code="${branch.branch_code}">${branch.bill_address || ''}</td>
            <td contenteditable="false" data-field="password" data-code="${branch.branch_code}">${branch.password || ''}</td>
            <td>
                <div class="branch-actions">
                    <button class="btn btn-primary btn-sm edit-btn">Edit</button>
                    <button class="btn btn-success btn-sm save-btn" style="display:none;">Save</button>
                    <button class="btn btn-secondary btn-sm cancel-btn" style="display:none;">Cancel</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteBranch('${branch.branch_code}')">Delete</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
    // Add event listeners for inline editing
    tbody.querySelectorAll('td[data-field]').forEach(cell => {
        cell.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                cell.blur();
            }
        });
    });

    // Editing logic: highlight, show Save/Cancel, only save/cancel on button click
    tbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-btn');
        const saveBtn = e.target.closest('.save-btn');
        const cancelBtn = e.target.closest('.cancel-btn');
        if (editBtn) {
            const row = editBtn.closest('tr');
            if (!row) return;
            // Disable editing for all rows first
            tbody.querySelectorAll('tr').forEach(tr => {
                tr.classList.remove('editing');
                tr.querySelectorAll('td[data-field]').forEach(td => {
                    td.contentEditable = "false";
                    td.classList.remove('edit-highlight');
                });
                tr.querySelectorAll('.save-btn, .cancel-btn').forEach(btn => btn.style.display = 'none');
                tr.querySelectorAll('.edit-btn').forEach(btn => btn.style.display = '');
            });
            // Enable editing for this row
            row.classList.add('editing');
            row.querySelectorAll('td[data-field]').forEach(td => {
                td.contentEditable = "true";
                td.classList.add('edit-highlight');
            });
            row.querySelector('.save-btn').style.display = '';
            row.querySelector('.cancel-btn').style.display = '';
            row.querySelector('.edit-btn').style.display = 'none';
            // Store original values for cancel
            row._originalValues = {};
            row.querySelectorAll('td[data-field]').forEach(td => {
                row._originalValues[td.getAttribute('data-field')] = td.textContent;
            });
        } else if (saveBtn) {
            const row = saveBtn.closest('tr');
            if (!row) return;
            // Save all edited fields
            const branchCode = row.querySelector('td[data-field]').getAttribute('data-code');
            const details = {};
            row.querySelectorAll('td[data-field]').forEach(td => {
                details[td.getAttribute('data-field')] = td.textContent.trim();
            });
            window.electronAPI.saveBranchDetailsForBranch({ branchCode, details }).then(result => {
                if (result.success) {
                    showMessage('Branch updated', 'success');
                } else {
                    showMessage(result.message || 'Failed to update branch', 'error');
                }
                // Reload table
                loadAllBranches();
            });
        } else if (cancelBtn) {
            const row = cancelBtn.closest('tr');
            if (!row) return;
            // Restore original values
            if (row._originalValues) {
                row.querySelectorAll('td[data-field]').forEach(td => {
                    const field = td.getAttribute('data-field');
                    td.textContent = row._originalValues[field];
                });
            }
            // Reset editing state
            row.classList.remove('editing');
            row.querySelectorAll('td[data-field]').forEach(td => {
                td.contentEditable = "false";
                td.classList.remove('edit-highlight');
            });
            row.querySelector('.save-btn').style.display = 'none';
            row.querySelector('.cancel-btn').style.display = 'none';
            row.querySelector('.edit-btn').style.display = '';
        }
    });
}

async function handleBranchEdit(e) {
    const cell = e.target;
    const branchCode = cell.getAttribute('data-code');
    const field = cell.getAttribute('data-field');
    const value = cell.textContent.trim();
    // Find branch
    const branch = allBranches.find(b => b.branch_code === branchCode);
    if (!branch) return;
    branch[field] = value;
    // Save to backend
    try {
        const details = {};
        details[field] = value;
        const result = await window.electronAPI.saveBranchDetailsForBranch({ branchCode, details });
        if (result.success) {
            showMessage('Branch updated', 'success');
        } else {
            showMessage(result.message || 'Failed to update branch', 'error');
        }
    } catch (err) {
        showMessage('Failed to update branch', 'error');
    }
}

function populateCategories() {
    const select = document.getElementById('productCategory');
    select.innerHTML = '<option value="">Select Category</option>';

    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });
}

function setupBranchForm() {
    const form = document.getElementById('branchForm');
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(form);
        // Generate branch code automatically
        const nextBranchCode = generateNextBranchCode();
        document.getElementById('autoBranchCode').textContent = nextBranchCode;
        const branchDetails = {
            branch_code: nextBranchCode,
            name: formData.get('branchName'),
            password: formData.get('branchPassword'),
            gst: formData.get('gst'),
            fssai: formData.get('fssai'),
            bill_address: formData.get('billAddress'),
            phone: formData.get('phone'),
            email: formData.get('email')
        };
        // Generate next available branch code (BR001, BR002, ...)
        function generateNextBranchCode() {
            const codes = allBranches.map(b => b.branch_code);
            let maxNum = 0;
            codes.forEach(code => {
                const match = code.match(/^BR(\d{3})$/);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            });
            const nextNum = (maxNum + 1).toString().padStart(3, '0');
            return `BR${nextNum}`;
        }

        try {
            // Create new branch
            const result = await window.electronAPI.createBranch(branchDetails);
            if (result.success) {
                showMessage('Branch created successfully', 'success');
                clearBranchForm();
                // Add new branch to allBranches and update table immediately with full details
                if (result.branchDetails) {
                    // Find if branch already exists in allBranches
                    const idx = allBranches.findIndex(b => b.branch_code === result.branchDetails.branch_code);
                    if (idx !== -1) {
                        allBranches[idx] = result.branchDetails;
                    } else {
                        allBranches.push(result.branchDetails);
                    }
                    // Also update branchData for form population
                    branchData = { branchDetails: result.branchDetails };
                    // Do NOT repopulate form here, just update table
                    populateBranchesTable();
                }
                // Reload branches for full sync
                await loadAllBranches();
                // Clear form again to ensure fields are empty
                clearBranchForm();
            } else {
                showMessage(result.message || 'Failed to create branch', 'error');
            }
        } catch (error) {
            console.error('Error creating branch:', error);
            showMessage('Failed to create branch', 'error');
        }
    });
}

// Load all products from all branches for admin table
async function loadAllProductsForAdmin() {
    products = [];
    console.log('All branches:', allBranches); // Debug log for branches
    for (const branch of allBranches) {
        const result = await window.electronAPI.getBranchData(branch.branch_code);
        console.log(`Branch ${branch.branch_code} getBranchData result:`, result); // Detailed debug log for each branch
        if (result.success && result.data && Array.isArray(result.data.products)) {
            products = products.concat(result.data.products);
        }
    }
}

function setupProductHandlers() {
    // Add product button
    window.addProduct = async function () {
        const name = document.getElementById('productName').value.trim();
        const category = document.getElementById('productCategory').value;
        const branch = document.getElementById('productBranch').value;
        const shortcut = parseInt(document.getElementById('productShortcut').value);
        const price = parseFloat(document.getElementById('productPrice').value);

        if (!name || !category || !branch || isNaN(price) || isNaN(shortcut)) {
            showMessage('Please fill in all product fields', 'error');
            return;
        }

        // Check if shortcut number already exists
        if (products.some(p => p.shortcut_number === shortcut)) {
            showMessage('Shortcut number already exists', 'error');
            return;
        }

        const newProduct = {
            product_id: Date.now().toString(),
            name: name,
            category: category,
            branch: branch,
            price: price,
            shortcut_number: shortcut,
            created_at: new Date().toISOString()
        };

    // Save only to the selected branch
    let branchProducts = products.filter(p => p.branch === branch);
    branchProducts.push(newProduct);
    // Save to backend for selected branch
    await window.electronAPI.saveProductsForBranch({ branchCode: branch, products: branchProducts });

    // Clear form
    document.getElementById('productName').value = '';
    document.getElementById('productCategory').value = '';
    document.getElementById('productBranch').value = '';
    document.getElementById('productPrice').value = '';
    document.getElementById('productShortcut').value = '';

    // Reload all products from all branches for table
    await loadAllProductsForAdmin();
    populateProductsTable();
    showMessage('Product added successfully', 'success');
    };
}

function setupOfferHandlers() {
    // Add offer button
    window.addOffer = async function () {
        const name = document.getElementById('offerName').value.trim();
        const discount = parseFloat(document.getElementById('offerDiscount').value);

        if (!name || isNaN(discount)) {
            showMessage('Please fill in offer name and discount percentage', 'error');
            return;
        }

        const newOffer = {
            offer_id: Date.now().toString(),
            name: name,
            discount: discount,
            created_at: new Date().toISOString()
        };

        offers.push(newOffer);

        // Clear form
        document.getElementById('offerName').value = '';
        document.getElementById('offerDiscount').value = '';

        // Save and refresh
        await saveOffers();
        // Immediately reload offers from the first branch and update table
        const branchDataResult = await window.electronAPI.getBranchData(allBranches[0]?.branch_code || '');
        if (branchDataResult.success && branchDataResult.data) {
            branchData = branchDataResult.data;
            populateOffersTable();
        }
        showMessage('Offer added successfully', 'success');
    };
}

async function saveProducts() {
    try {
        let result;
        if (selectedBranchCode) {
            // Only save products for the selected branch
            const branchProducts = products.filter(p => p.branch === selectedBranchCode);
            result = await window.electronAPI.saveProductsForBranch({ branchCode: selectedBranchCode, products: branchProducts });
        } else {
            result = await window.electronAPI.saveProducts(products);
        }
        if (!result.success) {
            throw new Error(result.message || 'Failed to save products');
        }
        if (selectedBranchCode) await loadBranchScopedData();
    } catch (error) {
        console.error('Error saving products:', error);
        showMessage('Failed to save products', 'error');
    }
}

async function saveOffers() {
    try {
        // Always save offers globally
        let result = await window.electronAPI.saveOffersForBranch({ branchCode: 'GLOBAL', offers });
        if (!result.success) {
            throw new Error(result.message || 'Failed to save offers');
        }
        // Reload offers from backend
        const branchDataResult = await window.electronAPI.getBranchData(selectedBranchCode || allBranches[0]?.branch_code || '');
        if (branchDataResult.success && branchDataResult.data) {
            offers = branchDataResult.data.offers || [];
        }
        populateOffersTable();
    } catch (error) {
        console.error('Error saving offers:', error);
        showMessage('Failed to save offers', 'error');
    }
}

function populateBranchForm() {
    if (branchData && branchData.branchDetails) {
        document.getElementById('branchName').value = branchData.branchDetails.name || '';
        document.getElementById('branchPassword').value = branchData.branchDetails.password || '';
        document.getElementById('gst').value = branchData.branchDetails.gst || '';
        document.getElementById('fssai').value = branchData.branchDetails.fssai || '';
        document.getElementById('billAddress').value = branchData.branchDetails.bill_address || '';
        document.getElementById('phone').value = branchData.branchDetails.phone || '';
        document.getElementById('email').value = branchData.branchDetails.email || '';
    }
}

function populateProductsTable() {
    const tbody = document.querySelector('#productsTable tbody');
    tbody.innerHTML = '';

    products.forEach(product => {
        const row = document.createElement('tr');
        // Find branch name from allBranches
        const branchObj = allBranches.find(b => b.branch_code === product.branch);
        const branchName = branchObj ? branchObj.name : product.branch;
        row.innerHTML = `
    <td>${product.name}</td>
    <td>${product.category}</td>
    <td>${branchName}</td>
    <td>${product.shortcut_number}</td>
    <td>${product.price}</td>
    <td>
        <div class="action-buttons">
            <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.product_id}')">Delete</button>
        </div>
    </td>
`;
        tbody.appendChild(row);
    });
}

function populateOffersTable() {
    const tbody = document.querySelector('#offersTable tbody');
    tbody.innerHTML = '';
    const offerList = branchData && Array.isArray(branchData.offers) ? branchData.offers : [];
    offerList.forEach(offer => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${offer.name}</td>
            <td>${offer.discount}</td>
            <td>
        <div class="action-buttons">
            <button class="btn btn-sm btn-danger" onclick="deleteOffer('${offer.offer_id}')">Delete</button>
        </div>
    </td>
`;
        tbody.appendChild(row);
    });
}

async function updateProduct(productId, field, value) {
    const product = products.find(p => p.product_id === productId);
    if (product) {
        if (field === 'price') {
            product[field] = parseFloat(value);
        } else if (field === 'shortcut_number') {
            product[field] = parseInt(value);
        } else {
            product[field] = value;
        }

        await saveProducts();
        showMessage('Product updated', 'success');
    }
}

async function updateOffer(offerId, field, value) {
    const offer = offers.find(o => o.offer_id === offerId);
    if (offer) {
        if (field === 'percent') {
            offer[field] = parseFloat(value);
        } else if (field === 'active') {
            offer[field] = value;
        } else {
            offer[field] = value;
        }

        await saveOffers();
        showMessage('Offer updated', 'success');
    }
}

async function deleteProduct(productId) {
    window.showConfirmModal('Are you sure you want to delete this product?', async () => {
        // Find the product to delete
        const productToDelete = products.find(p => p.product_id === productId);
        if (!productToDelete) return;
        // Remove from products array
        products = products.filter(p => p.product_id !== productId);
        // Set selectedBranchCode to the product's branch
        selectedBranchCode = productToDelete.branch;
        // Save only products for this branch
        const branchProducts = products.filter(p => p.branch === selectedBranchCode);
        await window.electronAPI.saveProductsForBranch({ branchCode: selectedBranchCode, products: branchProducts });
        await loadAllProductsForAdmin(); // Reload all products from all branches
        populateProductsTable();
        showMessage('Product deleted', 'success');
    });
}

async function deleteOffer(offerId) {
    window.showConfirmModal('Are you sure you want to delete this offer?', async () => {
        offers = offers.filter(o => o.offer_id !== offerId);
        await saveOffers();
        // Reload branch data and update offers table
        const branchDataResult = await window.electronAPI.getBranchData(selectedBranchCode || allBranches[0]?.branch_code || '');
        if (branchDataResult.success && branchDataResult.data) {
            branchData = branchDataResult.data;
            offers = branchData.offers || [];
        }
        populateOffersTable();
        showMessage('Offer deleted', 'success');
    });
}

function clearBranchDetails() {
    window.showConfirmModal('Are you sure you want to clear all branch details? This action cannot be undone.', () => {
        branchData.branchDetails = {
            branch_code: branchData.branchDetails.branch_code,
            name: '',
            gst: '',
            fssai: '',
            bill_header: '',
            last_sync_ts: new Date().toISOString()
        };
        populateBranchForm();
        showMessage('Branch details cleared', 'success');
    });
}

function updateBranchInfo() {
    if (branchData && branchData.branchDetails) {
        document.getElementById('branchInfo').textContent = `Branch: ${branchData.branchDetails.name || branchData.branchDetails.branch_code}`;
        document.getElementById('lastSync').textContent = `Last Sync: ${new Date(branchData.branchDetails.last_sync_ts).toLocaleString()}`;
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

async function pushSync() {
    try {
        showMessage('Pushing updates to Google Drive...', 'info');

        const result = await window.electronAPI.pushSync();

        if (result.success) {
            showMessage('Sync package prepared successfully. Google Drive integration needed.', 'success');
            updateBranchInfo();
        } else {
            showMessage(result.message || 'Sync failed', 'error');
        }
    } catch (error) {
        console.error('Push sync error:', error);
        showMessage('Sync failed', 'error');
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

// Category modal functions
function openCategoryModal() {
    document.getElementById('categoryModal').style.display = 'block';
    document.getElementById('newCategoryName').focus();
}

function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
    document.getElementById('newCategoryName').value = '';
}

function addCategory() {
    const categoryName = document.getElementById('newCategoryName').value.trim();

    if (!categoryName) {
        showMessage('Please enter a category name', 'error');
        return;
    }

    if (categories.includes(categoryName)) {
        showMessage('Category already exists', 'error');
        return;
    }

    categories.push(categoryName);
    const unique = Array.from(new Set(categories));
    window.electronAPI.saveCategoriesToAllBranches(unique).then(async res => {
        if (!res.success) throw new Error('Failed saving categories');
        await loadBranchScopedData();
        closeCategoryModal();
        showMessage('Category added successfully to all branches', 'success');
    }).catch(err => {
        console.error(err);
        showMessage('Failed to save category', 'error');
    });
}

// Branch management functions
function clearBranchForm() {
    document.getElementById('branchForm').reset();
}

function editBranch(branchCode) {
    const branch = allBranches.find(b => b.branch_code === branchCode);
    if (branch) {
        document.getElementById('branchCode').value = branch.branch_code;
        document.getElementById('branchName').value = branch.name;
        document.getElementById('branchPassword').value = '';
        document.getElementById('gst').value = branch.gst || '';
        document.getElementById('fssai').value = branch.fssai || '';
        document.getElementById('billAddress').value = branch.bill_address || '';
        document.getElementById('phone').value = branch.phone || '';
        document.getElementById('email').value = branch.email || '';

        // Scroll to form
        document.getElementById('branchForm').scrollIntoView({ behavior: 'smooth' });
    }
}

async function deleteBranch(branchCode) {
    window.showConfirmModal(`Are you sure you want to delete branch ${branchCode}?`, async () => {
        try {
            const result = await window.electronAPI.deleteBranch(branchCode);
            if (result.success) {
                showMessage('Branch deleted successfully', 'success');
                clearBranchForm();
                // Reset selectedBranchCode to first available branch or empty
                await loadAllBranches();
                if (allBranches.length > 0) {
                    selectedBranchCode = allBranches[0].branch_code;
                    await loadBranchScopedData();
                } else {
                    selectedBranchCode = '';
                }
            } else {
                showMessage(result.message || 'Failed to delete branch', 'error');
            }
        } catch (error) {
            console.error('Error deleting branch:', error);
            showMessage('Failed to delete branch', 'error');
        }
    });
}

// Product filtering functions
function filterProductsByBranch() {
    const selectedBranch = document.getElementById('branchFilter').value;
    let filteredProducts = products;
    if (selectedBranch) {
        filteredProducts = products.filter(p => p.branch === selectedBranch);
    }
    const tbody = document.querySelector('#productsTable tbody');
    tbody.innerHTML = '';
    filteredProducts.forEach(product => {
        const row = document.createElement('tr');
        const branchObj = allBranches.find(b => b.branch_code === product.branch);
        const branchName = branchObj ? branchObj.name : product.branch;
        row.innerHTML = `
    <td>${product.name}</td>
    <td>${product.category}</td>
    <td>${branchName}</td>
    <td>${product.shortcut_number}</td>
    <td>${product.price}</td>
    <td>
        <div class="action-buttons">
            <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.product_id}')">Delete</button>
        </div>
    </td>
`;
        tbody.appendChild(row);
    });
}

function clearProductFilter() {
    document.getElementById('branchFilter').value = '';
    const rows = document.querySelectorAll('#productsTable tbody tr');
    rows.forEach(row => {
        row.style.display = '';
    });
}

function logout() {
    window.showConfirmModal('Are you sure you want to logout?', () => {
        window.location.href = 'index.html';
    });
}
