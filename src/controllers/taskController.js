const { tasksApi } = require("../config/asana");

const getTask = async (req, res) => {
  try {
    const taskGid = req.params.taskId;
    const opts = {
      opt_fields: "name,assignee,workspace,custom_fields",
    };

    const result = await tasksApi.getTask(taskGid, opts);
    res.json(result.data);
  } catch (error) {
    console.error(
      "Error fetching task:",
      error.response?.body || error.message
    );
    res.status(error.response?.statusCode || 500).json({
      error: error.response?.body || "Internal server error",
    });
  }
};

const getProjectTasks = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const opts = {
      opt_fields:
        "name,assignee,completed,due_on,notes,custom_fields,custom_field_settings",
      limit: 100,
    };

    const result = await tasksApi.getTasksForProject(projectId, opts);
    res.json(result.data);
  } catch (error) {
    console.error(
      "Error fetching project tasks:",
      error.response?.body || error.message
    );
    res.status(error.response?.statusCode || 500).json({
      error: error.response?.body || "Internal server error",
    });
  }
};

const getCompletedProjectTasks = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const opts = {
      opt_fields: "name,assignee.name,completed,completed_at,custom_fields",
      limit: 100,
    };

    const result = await tasksApi.getTasksForProject(projectId, opts);
    const completedTasks = result.data.filter((task) => task.completed);

    // Filter and transform tasks to include only specific custom fields
    const filteredTasks = completedTasks.map((task) => {
      const customFieldValues = {};

      if (task.custom_fields) {
        task.custom_fields.forEach((field) => {
          const fieldNames = [
            "Worker",
            "Status",
            "Paid with...",
            "Deposit",
            "Bonus",
            "Max bet",
            "WG",
            "Max win",
            "Balance",
            "Groups",
            "Received",
          ];

          if (fieldNames.includes(field.name)) {
            // Handle different types of custom fields
            if (field.enum_value) {
              customFieldValues[field.name] = field.enum_value.name;
            } else if (
              field.number_value !== null &&
              field.number_value !== undefined
            ) {
              customFieldValues[field.name] = field.number_value;
            } else if (field.text_value) {
              customFieldValues[field.name] = field.text_value;
            } else {
              customFieldValues[field.name] = field.display_value;
            }
          }
        });
      }

      return {
        task_name: task.name,
        assignee: task.assignee ? task.assignee.name : null,
        completed_at: task.completed_at,
        ...customFieldValues,
      };
    });

    res.json(filteredTasks);
  } catch (error) {
    console.error(
      "Error fetching completed tasks:",
      error.response?.body || error.message
    );
    res.status(error.response?.statusCode || 500).json({
      error: error.response?.body || "Internal server error",
    });
  }
};

module.exports = {
  getTask,
  getProjectTasks,
  getCompletedProjectTasks,
};
