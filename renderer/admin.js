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
    // Round Off UI logic
    const roundOffCheckbox = document.getElementById('roundOffCheckbox');
    const saveRoundOffBtn = document.getElementById('saveRoundOffBtn');
    const roundOffStatus = document.getElementById('roundOffStatus');
    // Load current round off setting
    window.electronAPI.getGlobalSettings && window.electronAPI.getGlobalSettings().then(settings => {
        if (settings && settings.roundOff) roundOffCheckbox.checked = true;
    });
    if (saveRoundOffBtn) {
        saveRoundOffBtn.onclick = async function() {
            const enabled = roundOffCheckbox.checked;
            const result = await window.electronAPI.saveGlobalSettings({ roundOff: enabled });
            if (result && result.success) {
                roundOffStatus.textContent = 'Saved!';
                setTimeout(() => { roundOffStatus.textContent = ''; }, 2000);
            } else {
                roundOffStatus.textContent = 'Failed to save.';
            }
        };
    }
    // Import Menu modal logic must be globally available before DOMContentLoaded
});

// Make import menu modal logic globally available
window.openImportMenuModal = function() {
    const modal = document.getElementById('importMenuModal');
    if (!modal) return;
    // Populate source and target branch dropdowns
    const srcSelect = document.getElementById('importSourceBranch');
    const tgtSelect = document.getElementById('importTargetBranch');
    srcSelect.innerHTML = '';
    tgtSelect.innerHTML = '';
    allBranches.forEach(branch => {
        const srcOpt = document.createElement('option');
        srcOpt.value = branch.branch_code;
        srcOpt.textContent = `${branch.branch_code} - ${branch.name}`;
        srcSelect.appendChild(srcOpt);
        const tgtOpt = document.createElement('option');
        tgtOpt.value = branch.branch_code;
        tgtOpt.textContent = `${branch.branch_code} - ${branch.name}`;
        tgtSelect.appendChild(tgtOpt);
    });
    // Default: target = current, source = first other branch
    if (selectedBranchCode) tgtSelect.value = selectedBranchCode;
    if (allBranches.length > 1) {
        const firstOther = allBranches.find(b => b.branch_code !== selectedBranchCode);
        if (firstOther) srcSelect.value = firstOther.branch_code;
    }
    document.getElementById('importMenuStatus').textContent = '';
    modal.style.display = 'block';
};

document.addEventListener('DOMContentLoaded', function () {
    // Import Menu button logic
    const importMenuBtn = document.getElementById('importMenuBtn');
    if (importMenuBtn) {
        importMenuBtn.onclick = window.openImportMenuModal;
    }
    window.closeImportMenuModal = function() {
        const modal = document.getElementById('importMenuModal');
        if (modal) modal.style.display = 'none';
    };
    window.proceedImportMenu = async function() {
        const src = document.getElementById('importSourceBranch').value;
        const tgt = document.getElementById('importTargetBranch').value;
        const overwrite = document.getElementById('importOverwrite').checked;
        const statusDiv = document.getElementById('importMenuStatus');
        if (!src || !tgt || src === tgt) {
            statusDiv.textContent = 'Please select different source and target branches.';
            return;
        }
        statusDiv.textContent = 'Importing...';
        // Fetch products from source branch
        const srcData = await window.electronAPI.getBranchData(src);
        if (!srcData.success || !srcData.data || !Array.isArray(srcData.data.products)) {
            statusDiv.textContent = 'Failed to load source branch menu.';
            return;
        }
        // Generate a new unique product_id for each imported product
        let newProducts = srcData.data.products.map(p => ({
            ...p,
            branch: tgt,
            product_id: Date.now().toString() + Math.floor(Math.random() * 1000000).toString() // Unique per import
        }));
        if (!overwrite) {
            // Merge: keep existing products in target branch that don't conflict by shortcut_number or name
            const tgtData = await window.electronAPI.getBranchData(tgt);
            if (tgtData.success && Array.isArray(tgtData.data.products)) {
                const existing = tgtData.data.products;
                // Only add products from source that don't exist in target by shortcut_number or name
                newProducts = [
                    ...existing,
                    ...newProducts.filter(np => !existing.some(ep => ep.shortcut_number === np.shortcut_number || ep.name === np.name))
                ];
            }
        }
        // Save to target branch
        const saveResult = await window.electronAPI.saveProductsForBranch({ branchCode: tgt, products: newProducts });
        if (saveResult.success) {
            statusDiv.textContent = 'Menu imported successfully!';
            await loadAllProductsForAdmin();
            populateProductsTable();
            // Close modal after success
            setTimeout(() => {
                const modal = document.getElementById('importMenuModal');
                if (modal) modal.style.display = 'none';
            }, 800);
        } else {
            statusDiv.textContent = saveResult.message || 'Failed to import menu.';
        }
    };
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
            window.electronAPI.saveBranchDetailsForBranch({ branchCode, details }).then(async result => {
                if (result.success) {
                    showMessage('Branch updated', 'success');
                    // Refresh branch table and branch form
                    await loadAllBranches();
                    populateBranchForm();
                } else {
                    showMessage(result.message || 'Failed to update branch', 'error');
                }
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
    let loadedProducts = [];
    console.log('All branches:', allBranches); // Debug log for branches
    for (const branch of allBranches) {
        const result = await window.electronAPI.getBranchData(branch.branch_code);
        console.log(`Branch ${branch.branch_code} getBranchData result:`, result); // Detailed debug log for each branch
        if (result.success && result.data && Array.isArray(result.data.products)) {
            loadedProducts = loadedProducts.concat(result.data.products);
        }
    }
    products = loadedProducts;
}

function setupProductHandlers() {
    // Add product button
    window.addProduct = async function () {
        const name = document.getElementById('productName').value.trim();
        const category = document.getElementById('productCategory').value;
        const branch = document.getElementById('productBranch').value;
        const shortcut = parseInt(document.getElementById('productShortcut').value);
        const price = parseFloat(document.getElementById('productPrice').value);
        const discount = parseFloat(document.getElementById('productDiscount').value) || 0;
        const addGST = document.getElementById('productAddGST').checked;

        // Validate required fields (shortcut is optional)
        if (!name || !category || !branch || isNaN(price)) {
            showMessage('All fields except shortcut # are required.', 'error');
            return;
        }
        // If shortcut is provided, validate it and check for duplicates
        let shortcutValue = document.getElementById('productShortcut').value;
        let shortcutParsed = shortcutValue ? parseInt(shortcutValue) : undefined;
        if (shortcutValue) {
            if (isNaN(shortcutParsed) || shortcutParsed < 1 || !Number.isInteger(shortcutParsed)) {
                showMessage('Shortcut # must be an integer ≥ 1 if provided.', 'error');
                return;
            }
            // Only check for duplicates within the same branch
            if (products.some(p => p.branch === branch && p.shortcut_number === shortcutParsed)) {
                showMessage('Shortcut number already exists for this branch', 'error');
                return;
            }
        }
        const newProduct = {
            product_id: Date.now().toString(),
            name: name,
            category: category,
            branch: branch,
            price: price,
            discount: discount,
            add_gst: addGST,
            created_at: new Date().toISOString()
        };
        // Only check for duplicate product_id within the same branch
        if (products.some(p => p.branch === branch && p.product_id === newProduct.product_id)) {
            showMessage('Product ID already exists for this branch', 'error');
            return;
        }
        if (shortcutValue) {
            newProduct.shortcut_number = shortcutParsed;
        }
        // Save only to the selected branch
        // Reload products for this branch to avoid duplicates
        let branchProducts = products.filter(p => p.branch === branch && p.product_id !== newProduct.product_id);
        // Add product to backend only if not duplicate
        // De-duplicate by shortcut number and product ID before saving
        const dedupedProducts = [];
        const seenIds = new Set();
        const seenShortcuts = new Set();
        [...branchProducts, newProduct].forEach(p => {
            const idKey = p.product_id;
            const shortcutKey = p.shortcut_number ? String(p.shortcut_number) : '';
            if (!seenIds.has(idKey) && (!shortcutKey || !seenShortcuts.has(shortcutKey))) {
                dedupedProducts.push(p);
                seenIds.add(idKey);
                if (shortcutKey) seenShortcuts.add(shortcutKey);
            }
        });
        const addBtn = document.getElementById('addProductBtn');
        if (addBtn) addBtn.disabled = true;
        // Show loading indicator
        const tbody = document.querySelector('#productsTable tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Loading products...</td></tr>';
        const result = await window.electronAPI.saveProductsForBranch({ branchCode: branch, products: dedupedProducts });
        if (!result.success) {
            showMessage(result.message || 'Failed to add product', 'error');
            if (addBtn) addBtn.disabled = false;
            return;
        }
        // Clear form
        document.getElementById('productName').value = '';
        document.getElementById('productCategory').value = '';
        document.getElementById('productBranch').value = '';
        document.getElementById('productPrice').value = '';
        document.getElementById('productShortcut').value = '';
        document.getElementById('productDiscount').value = '';
        document.getElementById('productAddGST').checked = false;
        // Only repopulate table after products are fetched
        await loadAllProductsForAdmin();
        populateProductsTable();
        if (addBtn) addBtn.disabled = false;
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
            showMessage(result.message || 'Failed to save products', 'error');
            return;
        }
    // Always reload products after save
    await loadAllProductsForAdmin();
    filterProductsByBranch();
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
            showMessage(result.message || 'Failed to save offers', 'error');
            return;
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

function populateProductsTable(filteredList) {
    const tbody = document.querySelector('#productsTable tbody');
    tbody.innerHTML = '';

    // Use filteredList if provided, otherwise use all products
    const list = Array.isArray(filteredList) ? filteredList : products;

    // Debug log: show products array before rendering
    console.log('[DEBUG] Products to display:', list);

    // Filter out duplicate products only within the same branch
    const seen = {};
    list.filter(p => {
        const key = p.branch + ':' + p.product_id;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
    }).forEach(product => {
        const row = document.createElement('tr');
        // Find branch name from allBranches
        const branchObj = allBranches.find(b => b.branch_code === product.branch);
        const branchName = branchObj ? branchObj.name : product.branch;
        row.setAttribute('data-branch', product.branch); // Store branch code in row
        row.innerHTML = `
    <td contenteditable="false" data-field="name" data-id="${product.product_id}">${product.name}</td>
    <td contenteditable="false" data-field="category" data-id="${product.product_id}">${product.category}</td>
    <td>${branchName}</td>
    <td contenteditable="false" data-field="shortcut_number" data-id="${product.product_id}">${product.shortcut_number || ''}</td>
    <td contenteditable="false" data-field="price" data-id="${product.product_id}">${product.price}</td>
    <td contenteditable="false" data-field="discount" data-id="${product.product_id}">${product.discount !== undefined ? product.discount : 0}</td>
    <td><input type="checkbox" class="gst-checkbox" data-id="${product.product_id}" ${(product.gst || product.add_gst) ? 'checked' : ''} disabled></td>
    <td>
        <div class="action-buttons">
            <button class="btn btn-primary btn-sm edit-btn">Edit</button>
            <button class="btn btn-success btn-sm save-btn" style="display:none;">Save</button>
            <button class="btn btn-secondary btn-sm cancel-btn" style="display:none;">Cancel</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.product_id}')">Delete</button>
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
                tr.querySelectorAll('.gst-checkbox').forEach(cb => cb.disabled = true);
                tr.querySelectorAll('.save-btn, .cancel-btn').forEach(btn => btn.style.display = 'none');
                tr.querySelectorAll('.edit-btn').forEach(btn => btn.style.display = '');
            });
            // Enable editing for this row
            row.classList.add('editing');
            row.querySelectorAll('td[data-field]').forEach(td => {
                td.contentEditable = "true";
                td.classList.add('edit-highlight');
            });
            row.querySelector('.gst-checkbox').disabled = false;
            row.querySelector('.save-btn').style.display = '';
            row.querySelector('.cancel-btn').style.display = '';
            row.querySelector('.edit-btn').style.display = 'none';
            // Store original values for cancel
            row._originalValues = {};
            row.querySelectorAll('td[data-field]').forEach(td => {
                row._originalValues[td.getAttribute('data-field')] = td.textContent;
            });
            // Store original GST value
            const gstCheckbox = row.querySelector('.gst-checkbox');
            row._originalValues['gst'] = gstCheckbox.checked;
        } else if (saveBtn) {
            const row = saveBtn.closest('tr');
            if (!row) return;
            // Save all edited fields
            const productId = row.querySelector('td[data-field]').getAttribute('data-id');
            const updated = {};
            row.querySelectorAll('td[data-field]').forEach(td => {
                let val = td.textContent.trim();
                const field = td.getAttribute('data-field');
                if (field === 'price' || field === 'discount') val = parseFloat(val);
                if (field === 'shortcut_number') val = val ? parseInt(val) : undefined;
                updated[field] = val;
            });
            // Save GST value
            const gstCheckbox = row.querySelector('.gst-checkbox');
            updated.gst = gstCheckbox.checked;
            // Update product in products array
            const idx = products.findIndex(p => p.product_id === productId);
            if (idx !== -1) {
                Object.assign(products[idx], updated);
                selectedBranchCode = products[idx].branch;
            }
            // Save all products for the branch after editing
            const branchCode = row.getAttribute('data-branch');
            let branchProducts = products.filter(p => p.branch === branchCode);
            // Replace the product in branchProducts with the edited one
            const prodIdx = branchProducts.findIndex(p => p.product_id === productId);
            if (prodIdx !== -1) {
                branchProducts[prodIdx] = { ...branchProducts[prodIdx], ...updated };
            }
            // De-duplicate by shortcut number and product ID before saving
            const dedupedProducts = [];
            const seenIds = new Set();
            const seenShortcuts = new Set();
            branchProducts.forEach(p => {
                const idKey = p.product_id;
                const shortcutKey = p.shortcut_number ? String(p.shortcut_number) : '';
                if (!seenIds.has(idKey) && (!shortcutKey || !seenShortcuts.has(shortcutKey))) {
                    dedupedProducts.push(p);
                    seenIds.add(idKey);
                    if (shortcutKey) seenShortcuts.add(shortcutKey);
                }
            });
            console.log('[DEBUG] Saving products for branch', branchCode, dedupedProducts);
            window.electronAPI.saveProductsForBranch({ branchCode, products: dedupedProducts }).then(result => {
                if (!result.success) {
                    showMessage(result.message || 'Failed to save products', 'error');
                } else {
                    showMessage('Product updated', 'success');
                }
                // Always reload all products for all branches and refresh table with filter
                loadAllProductsForAdmin().then(() => {
                    filterProductsByBranch();
                });
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
                // Restore GST value
                const gstCheckbox = row.querySelector('.gst-checkbox');
                gstCheckbox.checked = row._originalValues['gst'];
                gstCheckbox.disabled = true;
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
        // Find the product to delete (must match both product_id and branch)
        const productToDelete = products.find(p => p.product_id === productId && p.branch === selectedBranchCode);
        if (!productToDelete) return;
        // Remove only the product with matching product_id and branch
        products = products.filter(p => !(p.product_id === productId && p.branch === selectedBranchCode));
        // Save only products for this branch
        const branchProducts = products.filter(p => p.branch === selectedBranchCode);
        const result = await window.electronAPI.saveProductsForBranch({ branchCode: selectedBranchCode, products: branchProducts });
        if (!result.success) {
            showMessage(result.message || 'Failed to delete product', 'error');
            return;
        }
        await loadAllProductsForAdmin(); // Reload all products from all branches
        filterProductsByBranch();
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
        const branchInfo = document.getElementById('branchInfo');
        const lastSync = document.getElementById('lastSync');
        if (branchInfo) branchInfo.textContent = `Branch: ${branchData.branchDetails.name || branchData.branchDetails.branch_code}`;
        if (lastSync) lastSync.textContent = `Last Sync: ${new Date(branchData.branchDetails.last_sync_ts).toLocaleString()}`;
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
        showMessage('Uploading Excel to backend...', 'info');
        const result = await window.electronAPI.pushSync();
        if (result.success) {
            showMessage('Excel uploaded and branch synced via backend.', 'success');
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
        // Reload categories and products for all branches
        await loadAllBranches();
        await loadAllProductsForAdmin();
        populateCategories();
        populateProductsTable();
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
    if (!selectedBranch) {
        loadAllProductsForAdmin().then(() => {
            populateProductsTable();
        });
        return;
    }
    const filteredProducts = products.filter(p => p.branch === selectedBranch);
    populateProductsTable(filteredProducts);
}

function logout() {
    window.showConfirmModal('Are you sure you want to logout?', () => {
        window.location.href = 'index.html';
    });
}
