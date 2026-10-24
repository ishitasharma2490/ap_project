const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')

const videosFile = path.join(__dirname, '..', 'data', 'videos.json')
const sampleData = require('../data/sampleData')
const historyFile = path.join(__dirname, '..', 'data', 'watchHistory.json')

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function ensureVideosFile() {
  const existing = readJSON(videosFile)

  if (!existing || !Array.isArray(existing) || existing.length === 0) {
    const seeded = sampleData.map((v) => ({
      _id: generateId(),
      title: v.title,
      description: v.description,
      videoUrl: v.videoUrl,
      localFile: v.localFile,
      thumbnail: v.thumbnail,
      likes: v.likes || 0,
      views: v.views || 0,
      comments: (v.comments || []).map((c) => ({
        _id: generateId(),
        author: c.author,
        text: c.text,
        createdAt: new Date().toISOString()
      })),
      createdAt: new Date().toISOString()
    }))

    writeJSON(videosFile, seeded)
    return seeded
  }

  return existing
}

function readHistory() {
  try {
    const raw = fs.readFileSync(historyFile, 'utf8')
    const history = JSON.parse(raw)
    return Array.isArray(history) ? history : []
  } catch (e) {
    return []
  }
}

function writeHistory(arr) {
  fs.writeFileSync(historyFile, JSON.stringify(arr, null, 2))
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.ogg') return 'video/ogg'

  return 'application/octet-stream'
}

ensureVideosFile()

// POST /api/videos/seed
router.post('/seed', (req, res) => {
  try {
    const seeded = sampleData.map((v) => ({
      _id: generateId(),
      title: v.title,
      description: v.description,
      videoUrl: v.videoUrl,
      localFile: v.localFile,
      thumbnail: v.thumbnail,
      likes: v.likes || 0,
      views: v.views || 0,
      comments: (v.comments || []).map((c) => ({
        _id: generateId(),
        author: c.author,
        text: c.text,
        createdAt: new Date().toISOString()
      })),
      createdAt: new Date().toISOString()
    }))

    writeJSON(videosFile, seeded)
    res.json({ ok: true, inserted: seeded.length })
  } catch (err) {
    console.error('Seed failed', err)
    res.status(500).json({ error: 'Seed failed' })
  }
})

// GET /api/videos/stream/:id
router.get('/stream/:id', (req, res) => {
  const id = req.params.id
  const videos = readJSON(videosFile) || []
  const video = videos.find((x) => x._id === id)

  if (!video) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (!video.localFile) {
    return res.status(404).json({ error: 'No local file available' })
  }

  const videoPath = path.join(
    __dirname,
    '..',
    'media',
    path.basename(video.localFile)
  )

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'File not found' })
  }

  const { size } = fs.statSync(videoPath)
  const range = req.headers.range
  const contentType = getMimeType(videoPath)

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1

    if (
      isNaN(start) ||
      isNaN(end) ||
      start < 0 ||
      start > end ||
      end >= size
    ) {
      res.status(416).set({
        'Content-Range': `bytes */${size}`
      }).send('Requested range not satisfiable')
      return
    }

    const chunkSize = end - start + 1
    const stream = fs.createReadStream(videoPath, { start, end })

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    })

    stream.pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    })

    fs.createReadStream(videoPath).pipe(res)
  }
})

// GET /api/videos - List videos, optionally filter by title
router.get('/', (req, res) => {
  try {
    const videos = readJSON(videosFile) || []
    const title = (req.query.title || '').trim().toLowerCase()

    const filteredVideos = videos.filter((video) =>
      (video.title || '').toLowerCase().includes(title)
    )

    res.json(filteredVideos)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch videos' })
  }
})

// GET /api/videos/watch-history - Get watch history
router.get('/watch-history', (req, res) => {
  try {
    const history = readHistory()
    const videos = readJSON(videosFile) || []

    const result = history.map((item) => ({
      ...item,
      video: videos.find((v) => v._id === item.videoId) || null
    }))

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch watch history' })
  }
})

// POST /api/videos/watch-history - Add a video to history
router.post('/watch-history', (req, res) => {
  try {
    const { videoId } = req.body || {}

    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' })
    }

    const videos = readJSON(videosFile) || []
    const video = videos.find((v) => v._id === videoId)

    if (!video) {
      return res.status(404).json({ error: 'Video not found' })
    }

    let history = readHistory()

    history = history.filter((item) => item.videoId !== videoId)

    history.unshift({
      videoId,
      watchedAt: new Date().toISOString()
    })

    writeHistory(history)

    res.status(201).json({
      message: 'Watch history updated',
      videoId,
      watchedAt: history[0].watchedAt
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update watch history' })
  }
})

// DELETE /api/videos/watch-history - Clear watch history
router.delete('/watch-history', (req, res) => {
  try {
    writeHistory([])
    res.json({ message: 'Watch history cleared' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear watch history' })
  }
})

// GET /api/videos/:id - Get one video
router.get('/:id', (req, res) => {
  try {
    const videos = readJSON(videosFile) || []
    const video = videos.find((v) => v._id === req.params.id)

    if (!video) {
      return res.status(404).json({ error: 'Video not found' })
    }

    res.json(video)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch video' })
  }
})

// PUT /api/videos/:id/like - Like or unlike a video
router.put('/:id/like', (req, res) => {
  try {
    const { like } = req.body || {}
    const videos = readJSON(videosFile) || []
    const index = videos.findIndex((v) => v._id === req.params.id)

    if (index === -1) {
      return res.status(404).json({ error: 'Video not found' })
    }

    if (typeof like !== 'boolean') {
      return res.status(400).json({
        error: 'like must be true or false'
      })
    }

    const currentLikes = videos[index].likes || 0

    videos[index].likes = like
      ? currentLikes + 1
      : Math.max(0, currentLikes - 1)

    writeJSON(videosFile, videos)

    res.json({
      videoId: videos[index]._id,
      likes: videos[index].likes
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update likes' })
  }
})

// PUT /api/videos/:id/comments - Add a comment
router.put('/:id/comments', (req, res) => {
  try {
    const { author, text } = req.body || {}
    const videos = readJSON(videosFile) || []
    const index = videos.findIndex((v) => v._id === req.params.id)

    if (index === -1) {
      return res.status(404).json({ error: 'Video not found' })
    }

    if (
      typeof author !== 'string' ||
      !author.trim() ||
      typeof text !== 'string' ||
      !text.trim()
    ) {
      return res.status(400).json({
        error: 'author and text are required'
      })
    }

    const comment = {
      _id: generateId(),
      author: author.trim(),
      text: text.trim(),
      createdAt: new Date().toISOString()
    }

    if (!Array.isArray(videos[index].comments)) {
      videos[index].comments = []
    }

    videos[index].comments.push(comment)
    writeJSON(videosFile, videos)

    res.status(201).json(comment)
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// GET /api/videos/:id/likes - Get like count
router.get('/:id/likes', (req, res) => {
  try {
    const videos = readJSON(videosFile) || []
    const video = videos.find((v) => v._id === req.params.id)

    if (!video) {
      return res.status(404).json({ error: 'Video not found' })
    }

    res.json({
      videoId: video._id,
      likes: video.likes || 0
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch likes' })
  }
})

// GET /api/videos/:id/comments - Get comments
router.get('/:id/comments', (req, res) => {
  try {
    const videos = readJSON(videosFile) || []
    const video = videos.find((v) => v._id === req.params.id)

    if (!video) {
      return res.status(404).json({ error: 'Video not found' })
    }

    res.json(video.comments || [])
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' })
  }
})

module.exports = router
