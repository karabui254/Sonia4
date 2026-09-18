module.exports = {
  id: '006_flock_current_count_formula',
  up(database) {
    database.exec(`
      UPDATE flocks
      SET current_bird_count = MAX(0, initial_bird_count - mortality)
      WHERE initial_bird_count > 0;
    `);
  }
};
