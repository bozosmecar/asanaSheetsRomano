const express = require("express");
const router = express.Router();
const {
  getWorkspaceProjects,
  getAllProjectsWithTasks,
  exportProjectsToSheet,
  exportWorkspaceToSheet,
  getWorkspaceProjectById,
} = require("../controllers/projectController");

// Get all projects with their tasks (with optional workspaceId)
router.get("/workspace/all-with-tasks", getAllProjectsWithTasks);

// Export projects and tasks to Google Sheets
router.get("/workspace/export-to-sheets", exportProjectsToSheet);

// New endpoint for exporting specific workspace to a different sheet
router.get("/workspace/:workspaceId/export-to-sheets", exportWorkspaceToSheet);

// Get all projects in a workspace (with optional workspaceId)
router.get("/workspace/:workspaceId?", getWorkspaceProjects);

// Get a project by ID in a workspace (with optional workspaceId)
router.get(
  "/workspace/:workspaceId/project/:projectId",
  getWorkspaceProjectById
); // localhost:3000/api/projects/workspace/1201111111111111/project/1201111111111111

module.exports = router;
