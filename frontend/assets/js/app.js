// Initialize App
function initApp() {
    // Add ripple effect to buttons
    document.addEventListener('click', function (e) {
        const button = e.target.closest('.btn, .action-card, .scan-button, .analyze-button, .reset-button, .filter-btn, .export-btn, .pagination-btn, .action-btn');
        if (button) {
            createRipple(button, e);
        }
    });

    // Animate elements on scroll
    const elementsToAnimate = document.querySelectorAll('.action-card, .philosophy-item, .tech-card, .team-member, .stat-card');
    
    const animateOnScroll = () => {
        elementsToAnimate.forEach(element => {
            const elementPosition = element.getBoundingClientRect().top;
            const screenPosition = window.innerHeight / 1.3;

            if (elementPosition < screenPosition) {
                element.classList.add('is-visible');
            }
        });
    };

    window.addEventListener('scroll', animateOnScroll);
    animateOnScroll();
    
    // Initialize any page-specific functionality
    initPageSpecific();
}

// Page-specific initializations
function initPageSpecific() {
    const body = document.body;
    
    if (body.classList.contains('history-page')) {
        // History page specific initializations
        initHistoryPage();
    }
    
    if (body.classList.contains('upload-page')) {
        // Upload page specific initializations
        initUploadPage();
    }
    
    if (body.classList.contains('realtime-page')) {
        // Realtime page specific initializations
        initRealtimePage();
    }
}

function initHistoryPage() {
    // History page specific setup
    console.log('Initializing history page...');
}

function initUploadPage() {
    // Upload page specific setup
    console.log('Initializing upload page...');
}

function initRealtimePage() {
    // Realtime page specific setup
    console.log('Initializing realtime page...');
}

// ----- NAV ACTIVE HANDLER (auto-highlight menu bawah) -----
function setActiveNav() {
    const path = location.pathname || "/";
    let key;

    // route tanpa .html
    if (path === "/" || path === "/index.html") key = "index.html";
    else if (path === "/detect-realtime" || path.endsWith("/detect-realtime")) key = "detect-realtime.html";
    else if (path === "/detect-upload" || path.endsWith("/detect-upload")) key = "detect-upload.html";
    else if (path === "/history" || path.endsWith("/history")) key = "history.html";
    else if (path === "/about" || path.endsWith("/about")) key = "about.html";
    else key = path.split("/").pop() || "index.html"; // fallback untuk *.html

    const map = {
        "index.html": ['a[href="/"]', 'a[href="index.html"]'],
        "detect-realtime.html": ['a[href="detect-realtime.html"]'],
        "detect-upload.html": ['a[href="detect-upload.html"]'],
        "history.html": ['a[href="history.html"]', 'a[href="/history"]'],
        "about.html": ['a[href="about.html"]', 'a[href="/about"]'],
    };

    // reset
    document.querySelectorAll(".bottom-nav .nav-item").forEach(a => a.classList.remove("active"));
    // set active
    (map[key] || map["index.html"]).forEach(sel => {
        document.querySelectorAll(sel).forEach(a => a.classList.add("active"));
    });
}

// Create Ripple Effect
function createRipple(button, event) {
    const ripple = document.createElement('span');
    ripple.classList.add('ripple');

    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    ripple.style.width = ripple.style.height = `${diameter}px`;
    ripple.style.left = `${event.clientX - button.getBoundingClientRect().left - radius}px`;
    ripple.style.top = `${event.clientY - button.getBoundingClientRect().top - radius}px`;

    button.appendChild(ripple);

    setTimeout(() => {
        ripple.remove();
    }, 600);
}

// Add Ripple Styles
const rippleStyles = document.createElement('style');
rippleStyles.textContent = `
    .ripple {
        position: absolute;
        border-radius: 50%;
        background-color: rgba(255, 255, 255, 0.4);
        transform: scale(0);
        animation: ripple 600ms linear;
        pointer-events: none;
    }

    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(rippleStyles);

// Run when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setActiveNav();
});

// Hide loading screen when everything is loaded
window.addEventListener('load', () => {
    setTimeout(() => {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }
    }, 1500);
});

// Utility function for making API calls
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Export utility functions
window.utils = {
    apiCall,
    createRipple,
    setActiveNav
};