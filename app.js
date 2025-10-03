require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');

// --- 0. Require Models ---
const User = require('./models/User'); 
const MusicTrack = require('./models/MusicTrack');

// --- 0. App Initialization ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 

// --- Configuration Check (Critical) ---
if (!MONGO_URI) {
    console.error("FATAL ERROR: MONGO_URI is not defined in the environment variables (.env file).");
    process.exit(1);
}

// --- Initial Data Injection Function ---
async function populateTracks() {
    try {
        // IMPORTANT: We clear existing tracks to ensure the latest working URLs are loaded.
        await MusicTrack.deleteMany({});
        const count = await MusicTrack.countDocuments();
        
        if (count === 0) {
            console.log("Injecting fresh palate cleanser tracks...");
            await MusicTrack.insertMany([
                // Stable, generic YouTube EMBED URLs (MUST BE IN EMBED FORMAT)
                { name: "Tibetan Bowl Resonances", artist: "Calm Sounds", genre: "Ambient Drone", embedUrl: "https://www.youtube.com/embed/PjE2qf6F3F4" }, 
                { name: "Heavy Rain on Tin Roof", artist: "Nature Sounds", genre: "White Noise", embedUrl: "https://www.youtube.com/embed/q76bMAP1Xqg" },
                { name: "Symphony No. 5 (First Movement)", artist: "Classical Archive", genre: "Unexpected Classical", embedUrl: "https://www.youtube.com/embed/j_8CAgq7v0M" },
                { name: "1980s Game Menu Music", artist: "Retro Arcade", genre: "Chiptune", embedUrl: "https://www.youtube.com/embed/S_7gN8P5b9E" },
                { name: "French Jazz Cafe", artist: "Bistro Background", genre: "Lo-Fi Instrumental", embedUrl: "https://www.youtube.com/embed/m6lH_S_z-xM" },
            ]);
            console.log("Initial tracks created successfully.");
        }
    } catch (err) {
        console.error("Error during track population:", err.message);
    }
}

// --- 1. Database Connection & Server Start ---
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('MongoDB Connected!');
        app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
        populateTracks();
    })
    .catch(err => console.error('FATAL MongoDB connection error:', err.message));


// --- 2. Middleware ---
app.set('view engine', 'ejs');
app.use(express.static('public')); // Serve static files (like CSS)
app.use(express.urlencoded({ extended: true })); // Parse form data bodies

// Session Middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI, // Use the same URI for the session store
        collectionName: 'sessions'
    }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day cookie life
}));

// Simple Auth Checker Middleware
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        // Redirects users to login if they try to access a protected page
        res.redirect('/login'); 
    }
}

// --- 3. Routes ---

// AUTH ROUTES (Register, Login, Logout)
app.get('/register', (req, res) => res.render('register', { error: '' }));
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password || password.length < 6) {
             return res.render('register', { error: 'Username/Password cannot be empty or password too short.' });
        }
        const user = new User({ username, password });
        await user.save();
        req.session.userId = user._id;
        res.redirect('/');
    } catch (err) {
        let errorMsg = 'An error occurred during registration.';
        if (err.code === 11000) { 
            errorMsg = 'That username is already taken. Please try another.';
        }
        res.render('register', { error: errorMsg });
    }
});
app.get('/login', (req, res) => res.render('login', { error: '' }));
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await user.comparePassword(password))) {
            return res.render('login', { error: 'Invalid username or password.' });
        }
        req.session.userId = user._id;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error during login process.');
    }
});
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Could not log out.');
        res.redirect('/login');
    });
});


// ADD CUSTOM TRACK ROUTE
app.post('/add', isAuthenticated, async (req, res) => {
    const { name, artist, genre, embedUrl } = req.body;
    try {
        if (!name || !embedUrl.includes('youtube.com/embed/')) {
            return res.redirect('/?error=' + encodeURIComponent('Invalid track details: Name is required, and URL must be a YouTube embed link.')); 
        }
        const newTrack = new MusicTrack({ 
            name, 
            artist: artist || "User Contributed",
            genre: genre || "Unknown Palate Cleanser",
            embedUrl 
        });
        await newTrack.save();
        res.redirect('/'); 
    } catch (err) {
        console.error("Error adding custom track:", err.message);
        res.status(500).send('Error adding track. Check server logs.');
    }
});

// DELETE TRACK ROUTE (New addition for Browse page)
app.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        const trackId = req.params.id;
        
        // 1. Remove the track from the MusicTrack collection
        await MusicTrack.findByIdAndDelete(trackId);
        
        // 2. Remove this track ID from the 'favorites' array of ALL users 
        await User.updateMany(
            {}, 
            { $pull: { favorites: trackId } } 
        );

        // Redirect back to the browse page to see the updated list
        res.redirect('/browse'); 
    } catch (err) {
        console.error("Error deleting track:", err.message);
        res.status(500).send('Error processing deletion.');
    }
});

// BROWSE ALL TRACKS ROUTE
app.get('/browse', async (req, res) => {
    try {
        // Fetch ALL tracks. Populate favorites if user is logged in.
        const tracks = await MusicTrack.find({});
        let user = null;
        if (req.session.userId) {
            user = await User.findById(req.session.userId).populate('favorites'); 
        }
        res.render('browse', {
            tracks: tracks,
            user: user
        });
    } catch (err) {
        console.error("Error fetching all tracks:", err.message);
        res.status(500).send('Error loading track list.');
    }
});


// MAIN ROUTE (Randomizer)
app.get('/', async (req, res) => {
    let track = null;
    let user = null;
    let tracksCount = 0; 
    let error = req.query.error || ''; 
    
    try {
        tracksCount = await MusicTrack.countDocuments();
        const randomTrack = await MusicTrack.aggregate([{ $sample: { size: 1 } }]);
        track = randomTrack[0];

        if (req.session.userId) {
            user = await User.findById(req.session.userId);
        }

    } catch (err) {
        console.error("Error fetching random track:", err.message);
        error = error || 'Database error: Could not fetch tracks.';
    }
    
    res.render('index', { 
        track: track, 
        user: user,
        tracksCount: tracksCount,
        error: error
    });
});

// FAVORITE MANAGEMENT ROUTES
app.post('/favorite/:id', isAuthenticated, async (req, res) => {
    try {
        const trackId = req.params.id;
        const userId = req.session.userId;
        await User.findByIdAndUpdate(userId, { $addToSet: { favorites: trackId } });
        res.redirect('/favorites');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving favorite.');
    }
});
app.post('/unfavorite/:id', isAuthenticated, async (req, res) => {
    try {
        const trackId = req.params.id;
        const userId = req.session.userId; 
        await User.findByIdAndUpdate(userId, { $pull: { favorites: trackId } });
        res.redirect('/favorites');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error removing favorite.');
    }
});

// VIEW FAVORITE TRACKS ROUTE
app.get('/favorites', isAuthenticated, async (req, res) => {
    try {
        // Populates both user and the actual tracks in the favorites array
        const user = await User.findById(req.session.userId).populate('favorites'); 
        
        res.render('favorites', { 
            user: user,
            tracks: user.favorites 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching favorites.');
    }
});

// 404 Handler (Always last)
app.use((req, res) => {
    res.status(404).send('404 Not Found');
});