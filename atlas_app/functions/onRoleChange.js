exports = function(changeEvent) {
  const event = JSON.stringify(changeEvent, null, 2);
  cosnole.log(event);
};
