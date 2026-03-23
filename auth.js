// auth.js
// SUPABASE CONFIGURATION
const SUPABASE_URL = 'https://ecjyjhqotkavtajllxae.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HUBN798yex9CITkuQBVN5w_uUc_pkrT';

// Initialize the Supabase Client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM Elements
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

// Generic error/success display 
function showMessage(messageId, messageText) {
    const el = document.getElementById(messageId);
    if (el) {
        el.textContent = messageText;
        el.style.display = 'block';
    } else {
        alert(messageText);
    }
}

function clearMessage(messageId) {
    const el = document.getElementById(messageId);
    if (el) el.style.display = 'none';
}

// ----------------------
// LOGIN LOGIC (CUSTOM MVP TABLE)
// ----------------------
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        clearMessage('login-error');
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const submitBtn = document.getElementById('login-submit-btn');
        
        const originalText = submitBtn.textContent;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authenticating...';
        submitBtn.disabled = true;

        try {
            // Direct query to the custom 'users' table
            const { data, error } = await supabaseClient
                .from('users')
                .select('*')
                .eq('email', email)
                .eq('password', password)
                .single();

            if (error || !data) {
                throw new Error("Invalid email or password.");
            }
            
            // Success
            localStorage.setItem('tradingBotUser', JSON.stringify(data));
            window.location.href = 'index.html';

        } catch (error) {
            console.error('Login error:', error.message);
            showMessage('login-error', error.message || 'Failed to sign in.');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

// ----------------------
// SIGNUP LOGIC (CUSTOM MVP TABLE)
// ----------------------
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        clearMessage('signup-error');
        clearMessage('signup-success');
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const submitBtn = document.getElementById('signup-submit-btn');
        
        const originalText = submitBtn.textContent;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating...';
        submitBtn.disabled = true;

        try {
            // 1. Check if user already exists in custom table
            const { data: existingUser } = await supabaseClient
                .from('users')
                .select('id')
                .eq('email', email)
                .maybeSingle();

            if (existingUser) {
                throw new Error("An account with this email already exists.");
            }

            // 2. Insert new user into custom table
            const { data, error } = await supabaseClient
                .from('users')
                .insert([{ email: email, password: password }])
                .select();

            if (error) throw error;
            
            // Success
            const successEl = document.getElementById('signup-success');
            if (successEl) successEl.style.display = 'block';
            
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);

        } catch (error) {
            console.error('Signup error:', error.message);
            showMessage('signup-error', error.message || 'Failed to create account.');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}
