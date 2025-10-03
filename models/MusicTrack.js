const mongoose = require('mongoose');

const MusicTrackSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    artist: {
        type: String,
    },
    genre: {
        type: String,
    },
    // This is the YouTube/SoundCloud embed link (e.g., https://www.youtube.com/embed/dQw4w9WgXcQ)
    embedUrl: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('MusicTrack', MusicTrackSchema);