"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
    await queryInterface.changeColumn("SlackChannels", "slackId", {
      unique: true,
      type: Sequelize.STRING
    });
    await queryInterface.addColumn("SlackChannels", "mattermostName", {
      type: Sequelize.STRING
    });
    await queryInterface.addColumn("SlackChannels", "mattermostId", {
      type: Sequelize.STRING,
      unique: true,
    });
    await queryInterface.addColumn("SlackChannels", "forwardUrl", {
      type: Sequelize.STRING
    });
    await queryInterface.addColumn("SlackChannels", "lastCursor", {
      type: Sequelize.STRING
    });
    await queryInterface.addColumn("SlackChannels", "lastUpdatedAt", {
      type: Sequelize.DATE
    });
  },

  async down(queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
  },
};
