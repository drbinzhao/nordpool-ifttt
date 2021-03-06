const schedule = require('node-schedule');
const nordpool = require('nordpool');
const moment = require('moment-timezone');
const prices = new nordpool.Prices();
const config = require('./config');
const findStreak = require('findstreak');
const request = require('request');

const lowEvent = 'nordpool-price-low';
const normEvent = 'nordpool-price-normal';
const highEvent = 'nordpool-price-high';

const iftttUrl = 'https://maker.ifttt.com/trigger/';

let myTZ = moment.tz.guess();
let jobs = [];

// get latest prices immediately
getPrices();

// Prices for tomorrow are published today at 12:42 CET or later
// (http://www.nordpoolspot.com/How-does-it-work/Day-ahead-market-Elspot-/)
// update prices at 13:00 UTC
let cronPattern = moment.tz('13:00Z', 'HH:mm:Z', myTZ).format('m H * * *');
// cronPattern = '* */12 * * *';
// console.log(cronPattern);
let getPricesJob = schedule.scheduleJob(cronPattern, getPrices);

function getPrices() {
  prices.hourly(config, (error, results) => {
    if (error) {
      console.error(error);
      return;
    }
    let events = [];
    let tmpHours = [];
    let previousEvent = normEvent;
    results.forEach((item, index) => {
      item.date.tz(myTZ);
      if (config.vatPercent) {
        item.value = Math.round(item.value * (100 + config.vatPercent))/100;
      }
      if (item.value > config.highTreshold) {
        item.event = highEvent;
      }
      else if (item.value < config.lowTreshold) {
        item.event = lowEvent;
      }
      else {
        item.event = normEvent;
      }
      // treshold crossed; let's see what we have stored...
      if (item.event != previousEvent) {
        var max = 24;
        var lo = false;
        if (previousEvent == highEvent) {
          max = config.maxHighHours;
        }
        else if (previousEvent == lowEvent) {
          max = config.maxLowHours;
          var lo = true;
        }
        let rf = (a, b) => a + b.value;
        // stored values exist
        if (tmpHours.length > 0) {
          // find correct number of hours
          let streak = findStreak(tmpHours, max, rf, lo);
          // no events for the first normal streak 
          if ((events.length > 0) || (previousEvent != normEvent)) {
            // create an event from the first hour in the streak
            events.push(streak[0]);
          }
          // if only some of the stored hours were included in the streak,
          // mark the rest of the hours as normal and trigger events
          if ((previousEvent != normEvent) && (streak.length < tmpHours.length)) {
            let firstIndex = streak[0].date.get('hours') - tmpHours[0].date.get('hours');
            let lastIndex = firstIndex + streak.length;
            // hours were clipped from the beginning of stored hours
            if (firstIndex > 0) {
              tmpHours[0].event = normEvent;
              events.push(tmpHours[0]);
            }
            // hours were clipped from the end of stored hours
            if (tmpHours.length > lastIndex) {
              tmpHours[lastIndex].event = normEvent;
              events.push(tmpHours[lastIndex]);
            }
          }
        }
        // start a new treshold interval
        previousEvent = item.event;
        tmpHours = [];
      }
      // last hour in the Nordpool results, create event at the first stored hour
      else if (index == results.length - 1) {
        events.push(tmpHours[0]);
      }
      // store all items in the current treshold interval
      tmpHours.push(item);
    });
    // console.log(events);
    events.forEach(item => {
      jobs.push(schedule.scheduleJob(item.date.toDate(), trigger.bind(null, item)));
      console.log(item.date.format('D.M. H:mm'), item.value, item.event)
    });
  });
}

function trigger(item) {
  let values = {
    value1: item.value,
    value2: config.currency + '/MWh',
    value3: item.date.format('H:mm')
  };
  var opts = {
    url: iftttUrl + item.event + '/with/key/' + config.iftttKey,
    json: true,
    body: values
  };
  console.log('POSTing ' + item.event + ' event: ' + values.value1 + ' ' + values.value2 + ' at ' + values.value3);
  request.post(opts, function(err, res) {
    if (err) {
      console.error(err);
      return;
    }
    console.log('Success: ' + res.body)
  })
}
