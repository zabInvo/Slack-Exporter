'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class SlackChannel extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  SlackChannel.init({
    name: DataTypes.STRING,
    slackId: DataTypes.STRING,
    mattermostName: DataTypes.STRING,
    mattermostId : DataTypes.STRING,
    forwardUrl : DataTypes.STRING,
    lastCursor : DataTypes.STRING,
    type : DataTypes.STRING,
    membersCount : DataTypes.STRING,
    creationDate : DataTypes.STRING,
    lastUpdatedAt : DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'SlackChannel',
  });
  return SlackChannel;
};