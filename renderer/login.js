// Login page functionality
let currentTab = 'user';

// Predefined admin emails
const adminEmails = [
    'admin@posbilling.com',
    'manager@posbilling.com',
    'superadmin@posbilling.com'
];

document.addEventListener('DOMContentLoaded', function() {
    const userLoginForm = document.getElementById('userLoginForm');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const loading = document.getElementById('loading');

    // User login form submission
    userLoginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const branchPassword = document.getElementById('branchPassword').value.trim();

        if (!branchPassword) {
            showMessage('Please enter branch password', 'error');
            return;
        }

        // Show loading
        loading.style.display = 'block';
        document.getElementById('userLoginBtn').disabled = true;

        try {
            // Authenticate user with branch password
            const loginResult = await window.electronAPI.authenticateUser(branchPassword);
            
            if (!loginResult.success) {
                showMessage(loginResult.message || 'Invalid branch password', 'error');
                return;
            }

            // Store user info and branch data
            window.currentUser = { role: 'user', branchCode: loginResult.branchCode };
            window.branchData = loginResult.data;
            window.currentBranch = loginResult.branchCode; // <-- Set the branch for which user entered the password
            console.log('User logged in for branch:', loginResult.branchCode, loginResult.data);    
            showMessage('Login successful! Opening POS system...', 'success');

            // Navigate to user interface in the same window
            setTimeout(() => {
                window.location.href = 'user.html';
            }, 1000);

        } catch (error) {
            console.error('User login error:', error);
            showMessage('Login failed. Please try again.', 'error');
        } finally {
            loading.style.display = 'none';
            document.getElementById('userLoginBtn').disabled = false;
        }
    });

    // Admin login form submission
    adminLoginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const adminEmail = document.getElementById('adminEmail').value.trim();

        if (!adminEmail) {
            showMessage('Please enter admin email', 'error');
            return;
        }

        // Check if email is in admin list
        if (!adminEmails.includes(adminEmail.toLowerCase())) {
            showMessage('Invalid admin email', 'error');
            return;
        }

        // Show loading
        loading.style.display = 'block';
        document.getElementById('adminLoginBtn').disabled = true;

        try {
            // Store admin info
            window.currentUser = { role: 'admin', email: adminEmail };
            window.branchData = null; // Admin doesn't need specific branch data initially

            showMessage('Login successful! Opening admin dashboard...', 'success');

            // Navigate to admin interface in the same window
            setTimeout(() => {
                window.location.href = 'admin.html';
            }, 1000);

        } catch (error) {
            console.error('Admin login error:', error);
            showMessage('Login failed. Please try again.', 'error');
        } finally {
            loading.style.display = 'none';
            document.getElementById('adminLoginBtn').disabled = false;
        }
    });

    // Auto-focus on first input
    document.getElementById('branchPassword').focus();
});

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
    
    // Update current tab
    currentTab = tabName;
    
    // Focus on appropriate input
    setTimeout(() => {
        if (tabName === 'user') {
            document.getElementById('branchPassword').focus();
        } else {
            document.getElementById('adminEmail').focus();
        }
    }, 100);
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

// Handle keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Enter key on form inputs
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        if (currentTab === 'user') {
            document.getElementById('userLoginForm').dispatchEvent(new Event('submit'));
        } else {
            document.getElementById('adminLoginForm').dispatchEvent(new Event('submit'));
        }
    }
});
