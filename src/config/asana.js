const Asana = require("asana");

const client = Asana.ApiClient.instance;
const token = client.authentications["token"];
token.accessToken = process.env.ASANA_ACCESS_TOKEN;

const tasksApi = new Asana.TasksApi();

module.exports = {
  client,
  tasksApi,
};
