const express = require("express");
const router = express.Router();
const {
  getTask,
  getProjectTasks,
  getCompletedProjectTasks,
} = require("../controllers/taskController");

// Get a specific task by ID
router.get("/:taskId", getTask);

// Get all tasks from a specific project
router.get("/project/:projectId", getProjectTasks);

// Get only completed tasks from a specific project
router.get("/project/:projectId/completed", getCompletedProjectTasks);

module.exports = router;
