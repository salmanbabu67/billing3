// Common modal functions for admin and user
function showConfirmModal(message, onYes) {
    document.getElementById('confirmModalText').textContent = message;
    document.getElementById('confirmModal').style.display = 'block';
    const yesBtn = document.getElementById('confirmModalYes');
    yesBtn.onclick = function () {
        document.getElementById('confirmModal').style.display = 'none';
        onYes();
    };
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

// Export for usage in other scripts
window.showConfirmModal = showConfirmModal;
window.closeConfirmModal = closeConfirmModal;
