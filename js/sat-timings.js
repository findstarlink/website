// var moment, satellite, SunCalc, tzloookup;

if (typeof module !== "undefined") {
    moment = require('moment-timezone');
    satellite = require('satellite.js');
    SunCalc = require('suncalc');
    tzlookup = require('tz-lookup');

    module.exports = new StarlinkSatTimings();
}

function StarlinkSatTimings() {
    var parent = new SatTimings();

    this.getVisibleTimes = function (sat, latitude, longitude, opts) {
        var res = parent.getVisibleTimes(sat, latitude, longitude, opts);

        return res;
    };

    this.getSatellitePath = function (sat, mins) { // -X mins to +X mins
        return parent.getSatellitePath(sat, mins);
    };

    this.getCurrentSatelliteCoords = function (sat) {
        return parent.getCurrentSatelliteCoords(sat);
    };
}

function SatTimings() {
    var SAMPLES_PER_MIN = 12;

    var DEFAULT_API_VERSION = "1";
    var DEFAULT_DAYS_COUNT = 5; // days
    var DEFAULT_TIME_OF_DAY = 'all';
    var DEFAULT_SAT_PATH_DURATION = 90; // mins
    var DEFAULT_START_DAYS_OFFSET = 0; // days
    var DEFAULT_DAYS_VISIBLE_AFTER_LAUNCH_MS = 4 * 24 * 3600 * 1000; // days in ms

    var SUN_TO_EARTH_DIST = 147124525.068; // Km
    var EARTH_RADIUS = 6378.16; // Km
    var SUN_RADIUS = 695510; // Km

    /**
     * args:
     *   sat: object containing {name: "starlink2", title: "Starlink-2", omm: {...}, stdMag: 1.4, launchDate: "2020-04-22"}
     *   latitude: number (in degrees), North is positive, South is negative
     *   longitude: number (in degrees), East is positive, West is negative
     *   options: object {
     *     daysCount (optional): number, defaults to 5 days
     *     timeOfDay (optional): 'morning' or 'evening' or 'all', defaults to 'all'
     *     startDaysOffset (optional): number, defaults to 0 days, starting today. negative to go in past, positive for future
     *   }
     *
     * returns:
     *   {
     *     currentLocalTime: {time: "6:21 pm", date: "23 Jan 2020", epoch: 1579861567}, // epoch is always UTC (in sec)
     *     elementEpoch: 1579861567, // unix time (always UTC)
     *     timezone: "Europe/Budapest",
     *     timezoneOffset: "+01:00",
     *     timezoneOffsetText: "CEST",
     *     sunrise: "5:45 am",
     *     sunset: "6:32 pm",
     *     message: "Something about the results",
     *     timings: [
     *       {
     *          name: "starlink2",
     *          title: "Starlink-2",
     *          visibility: "good", // or "poor"
     *          start: {time: "7:43 pm", date: "24 Jan 2020", epoch: 1579861567}, // epoch is always UTC (in sec)
     *          end:   {time: "7:48 pm", date: "24 Jan 2020", epoch: 1579861883}, // epoch is always UTC (in sec)
     *          mins: 5,
     *          brightness: 2.4,
     *          brightnessText: "bright", // or "dim"
     *          startDir: 243.55,
     *          startDirText: "southwest",
     *          endDir: 35.5,
     *          endDirText: "northeast",
     *          startElev: 12.45, maxElev: 76.33, endElev: 40,
     *          azimuthAtMaXElev: 187.23
     *       }
     *     ]
     *   }
     */
    this.getVisibleTimes = function (sat, latitude, longitude, opts) {
        opts = setDefaultOptions(opts);

        var date = new Date();
        var timezone = tzlookup(latitude, longitude);
        var now = moment().tz(timezone);
        var tzOffset = now.format("Z");
        var tzOffsetText = now.format("z");
        var currentLocalTime = getTimestamp(now);

        var observer = {
            date: date,
            latitude: latitude,
            longitude: longitude,
            timezone: timezone
        };

        var sunInfo = getSunInfo(date, observer);

        // run simulation
        var satrec = ensureSatrec(sat);

        sat.launchEpochMs = -1;
        if (sat.launchDate !== undefined) {
            var launchDate = new Date(sat.launchDate);
            sat.launchEpochMs = launchDate.getTime();
        }

        var samples = getTimeSamples(sat, observer, opts);

        var rangedTimings = getRangedTimings(samples, observer);
        rangedTimings = filterRangedTimings(rangedTimings, sunInfo, observer, sat.launchEpochMs, opts);

        var formattedTimings = getFormattedTimings(sat.name, sat.title, rangedTimings);

        // prepare response
        var response = {
            currentLocalTime: currentLocalTime,
            elementEpoch: getElementEpoch(sat),
            timezone: timezone,
            timezoneOffset: tzOffset,
            timezoneOffsetText: tzOffsetText,
            sunrise: sunInfo.sunriseText,
            sunset: sunInfo.sunsetText,
            message: '',
            timings: formattedTimings
        };

        return response;
    }

    /**
     * args:
    *   sat: object containing {name: "starlink2", title: "Starlink-2", omm: {...}, stdMag: 1.4}
     *   mins (optional): number (in minutes) to find path, from -min/2 to +min/2
     *
     * returns:
     *   {
     *     startEpoch: 1579861567, // unix time (always UTC) of first path entry
     *     path: [
     *       [latitude (number), longitude (number)],
     *       ...
     *     ]
     *   }
     */
    this.getSatellitePath = function (sat, mins) { // -X mins to +X mins
        if (mins === undefined) {
            mins = DEFAULT_SAT_PATH_DURATION;
        }

        var listing = [];

        var RESOLUTION = 1;
        listingPeriod = mins * RESOLUTION; // mins
        var nHalf = parseInt(listingPeriod / 2);

        var satrec = ensureSatrec(sat);

        var time = getPropagationBaseDate(sat, satrec).getTime(); // ms
        var startTime = -1;

        for (i = -nHalf; i < nHalf + 1; i++) {
            var epochTimeMs = time + i * 1000 * (60 / RESOLUTION);
            if (startTime === -1) {
                startTime = epochTimeMs;
            }

            var date = new Date(epochTimeMs);
            var positionAndVelocity = propagateSatrec(satrec, date);
            if (positionAndVelocity === null) {
                continue;
            }
            var positionEci = positionAndVelocity.position;

            var gmst = satellite.gstime(date);
            var positionGd = satellite.eciToGeodetic(positionEci, gmst);

            var satLat = satellite.radiansToDegrees(positionGd.latitude);
            var satLong = satellite.radiansToDegrees(positionGd.longitude);

            listing.push([satLat, satLong]);
        }

        var result = {
            startEpoch: Math.floor(startTime / 1000),
            path: listing
        };

        return result;
    }

    this.getCurrentSatelliteCoords = function (sat) {
        var satrec = ensureSatrec(sat);
        var propagationDate = getPropagationBaseDate(sat, satrec);

        var positionAndVelocity = propagateSatrec(satrec, propagationDate);
        if (positionAndVelocity === null) {
            throw new Error('Unable to propagate satellite coordinates for current time');
        }
        var positionEci = positionAndVelocity.position;

        var gmst = satellite.gstime(new Date());
        var positionGd = satellite.eciToGeodetic(positionEci, gmst);

        var satLat = satellite.radiansToDegrees(positionGd.latitude);
        var satLong = satellite.radiansToDegrees(positionGd.longitude);
        var altitude = positionGd.height;

        return [satLat, satLong, altitude];
    }

    function setDefaultOptions(opts) {
        if (opts === undefined) {
            opts = {};
        }

        opts.apiVersion = (opts.apiVersion === undefined ? DEFAULT_API_VERSION : opts.apiVersion);

        opts.daysCount = (opts.daysCount === undefined ? DEFAULT_DAYS_COUNT : opts.daysCount);
        opts.timeOfDay = (opts.timeOfDay === undefined ? DEFAULT_TIME_OF_DAY : opts.timeOfDay);
        opts.startDaysOffset = (opts.startDaysOffset === undefined ? DEFAULT_START_DAYS_OFFSET : opts.startDaysOffset);

        return opts;
    }

    function getSunInfo(date, observer) {
        var sunInfo = SunCalc.getTimes(observer.date, observer.latitude, observer.longitude);
        sunInfo.sunrise = moment(sunInfo.sunrise).tz(observer.timezone);
        sunInfo.sunset = moment(sunInfo.sunset).tz(observer.timezone);
        sunInfo.sunriseText = sunInfo.sunrise.format("h:mm a");
        sunInfo.sunsetText = sunInfo.sunset.format("h:mm a");

        return sunInfo;
    }

    function getTimeSamples(sat, observer, opts) {
        var listingPeriod = 24 * 60 * SAMPLES_PER_MIN * opts.daysCount; // hours x minutes

        var startDaysOffset = parseInt(opts.startDaysOffset);

        var startTime = observer.date.getTime(); // ms
        startTime += startDaysOffset * 24 * 60 * 60 * 1000;

        var observerGd = {
            latitude: satellite.degreesToRadians(observer.latitude),
            longitude: satellite.degreesToRadians(observer.longitude),
            height: 0
        };

        var satrec = ensureSatrec(sat);

        var times = [];
        var prevTimingValid = false;
        var prevI = 0;
        var fastForwardAllowedAfterI = 0;

        for (i = 1; i < listingPeriod + 1; i++) {
            var epochTimeMs = startTime + i * 1000 * (60 / SAMPLES_PER_MIN);

            if (epochTimeMs < sat.launchEpochMs) {
                continue;
            }

            var date = new Date(epochTimeMs);
            var positionAndVelocity = propagateSatrec(satrec, date);
            if (positionAndVelocity === null) {
                continue;
            }
            var positionEci = positionAndVelocity.position;

            var gmst = satellite.gstime(date);

            var positionEcf = satellite.eciToEcf(positionEci, gmst);
            var lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

            var azimuth = satellite.radiansToDegrees(lookAngles.azimuth);
            var elevation = satellite.radiansToDegrees(lookAngles.elevation);

            var currTimingValid = (elevation >= 10 && elevation <= 170);

            // use fast scan to check if some duration can be skipped
            var loopInstruction = getLoopInstruction(i, prevI, currTimingValid, prevTimingValid, fastForwardAllowedAfterI, SAMPLES_PER_MIN);
            prevI = i;
            prevTimingValid = loopInstruction.prevTimingValid;
            i = loopInstruction.i;
            fastForwardAllowedAfterI = loopInstruction.fastForwardAllowedAfterI;

            if (loopInstruction.shouldContinue === true) {
                continue;
            }

            lookAngles.distance = lookAngles.rangeSat;

            var sunXYZ = getSunPosition(date);

            var eclipsed = isEclipsed(positionEci, sunXYZ);
            var brightness = getBrightness(date, observer.latitude, observer.longitude, lookAngles, sat.stdMag);

            // console.log(date, azimuth, elevation, brightness, eclipsed);

            times.push({ time: date, azimuth: azimuth, elevation: elevation, brightness: brightness[0], eclipsed: eclipsed });
        }

        return times;
    }

    function getRangedTimings(samples, observer) {
        var rangedTimes = [];

        var lastTime = -1, visibleSlices = 0;
        var eventStartTime, minElev = 10000, maxElev = -10000, startDir = 0, endDir = 0;
        var startElev = 10000, endElev;
        var azimuthAtMaxElev = -1;
        var bestBrightness = 10000; // lower the brighter

        if (samples.length < 2) {
            return rangedTimes;
        }

        samples.forEach(function (t, idx) {
            var timeDiff = -1;

            if (lastTime === -1) {
                visibleSlices = 0;
            } else {
                timeDiff = t.time.getTime() - lastTime.getTime();
            }

            if (timeDiff > 5 * 60 * 1000 || idx === samples.length - 1) { // finished slot
                // if (idx == samples.length - 1) {
                //     lastTime = t.time;
                // }

                if (visibleSlices > 0) {
                    var startMoment = moment(eventStartTime);
                    var startMomentTz = startMoment.tz(observer.timezone);
                    var endMoment = moment(lastTime);
                    var endMomentTz = endMoment.tz(observer.timezone);

                    var mins = parseInt((lastTime.getTime() - eventStartTime.getTime()) / (60 * 1000));

                    // console.log(eventStartTime, mins, visibleSlices, 'found');
                    if (mins > 0 && visibleSlices > 0) {
                        rangedTimes.push({
                            start: startMomentTz, end: endMomentTz,
                            mins: mins,
                            startDir: parseFloat(startDir.toFixed(2)),
                            endDir: parseFloat(endDir.toFixed(2)),
                            minElev: parseFloat(minElev.toFixed(2)),
                            maxElev: parseFloat(maxElev.toFixed(2)),
                            startElev: parseFloat(startElev.toFixed(2)),
                            endElev: parseFloat(endElev.toFixed(2)),
                            azimuthAtMaxElev: parseFloat(azimuthAtMaxElev.toFixed(2)),
                            bestBrightness: parseFloat(bestBrightness.toFixed(2))
                        });
                    }
                }

                eventStartTime = t.time;
                minElev = 10000;
                maxElev = -10000;
                startDir = t.azimuth;
                endDir = t.azimuth;
                bestBrightness = 10000;
                startElev = 10000;
                azimuthAtMaxElev = -1;
                visibleSlices = 0;
            }

            if (t.eclipsed === false) {
                endElev = t.elevation;
                endDir = t.azimuth;
                lastVisibleTime = t.time;

                visibleSlices++;

                if (startElev === 10000) {
                    startElev = t.elevation;
                    eventStartTime = t.time;
                    startDir = t.azimuth;
                }

                if (t.elevation < minElev) {
                    minElev = t.elevation;
                }
                if (t.elevation > maxElev) {
                    maxElev = t.elevation;
                    azimuthAtMaxElev = t.azimuth;
                }
                if (t.brightness < bestBrightness) { // magnitude goes in reverse
                    bestBrightness = t.brightness;
                }
            }

            lastTime = t.time;

            // console.log(t[1], t[8] + "km");

        });

        return rangedTimes;
    }

    function filterRangedTimings(rangedTimings, sunInfo, observer, satLaunchEpochMs, opts) {
        // flatten to the same day
        var sunriseNorm = normalizeMoment(sunInfo.sunrise, observer.timezone);
        var sunsetNorm = normalizeMoment(sunInfo.sunset, observer.timezone);

        var morningHourRange = [0, 12];
        var nowEpochMs = new Date().getTime();

        var filteredRange = rangedTimings.filter(function (e) {
            var startNormalized = normalizeMoment(e.start, observer.timezone);

            if (e.start.valueOf() < nowEpochMs) {
                e.startPrefix = '(past) ';
            }

            if (startNormalized.isAfter(sunriseNorm) && startNormalized.isBefore(sunsetNorm)) {
                return false;
            }

            if (e.bestBrightness > 7) {
                return false;
            }

            var timeFromSunrise = Math.abs(startNormalized.diff(sunriseNorm, 'minutes'));
            var timeFromSunset = Math.abs(startNormalized.diff(sunsetNorm, 'minutes'));

            var maxElev = parseInt(e.maxElev);

            if (timeFromSunrise < 50 || timeFromSunset < 50) {
                e.bestBrightness += 1.2;
            }

            if (timeFromSunrise < 20 || timeFromSunset < 20) { // too much twilight/dawn
                return false;
            } else if (timeFromSunrise < 30 || timeFromSunset < 30) { // sky still pretty bright, temp hack from 40
                e.timeType = 'poor';
            } else if ((maxElev < 30 || e.bestBrightness >= 4) && (timeFromSunrise < 50 || timeFromSunset < 50)) { // horizon haze still too bright
                e.timeType = 'poor';
            } else if (e.bestBrightness > 4 || maxElev < 25) {
                e.timeType = 'poor';
            } else {
                e.timeType = 'good';
            }

            if (e.timeType === 'good' && satLaunchEpochMs !== -1 && nowEpochMs > satLaunchEpochMs + DEFAULT_DAYS_VISIBLE_AFTER_LAUNCH_MS) {
                if (opts.apiVersion === "1") {
                    e.timeType = 'poor'; // older clients using v1 can only handle 'good' or 'poor' types
                } else {
                    e.timeType = 'average';
                }
            }

            if (opts.timeOfDay === 'morning') {
                return (startNormalized.hour() >= morningHourRange[0] && startNormalized.hour() <= morningHourRange[1]);
            } else if (opts.timeOfDay === 'evening') {
                return !(startNormalized.hour() >= morningHourRange[0] && startNormalized.hour() <= morningHourRange[1]);
            }

            return true;
        });

        return filteredRange;
    }

    function getFormattedTimings(satName, satTitle, rangedTimings) {
        var timings = [];

        rangedTimings.forEach(function (e) {
            var brightnessText = (e.bestBrightness < 4 ? 'bright' : 'dim');

            if (e.timeType === 'poor' || e.timeType === 'average') {
                brightnessText = 'dim';
            }

            var entry = {
                name: satName,
                title: satTitle,
                visibility: e.timeType,
                start: getTimestamp(e.start, (e.startPrefix !== undefined ? e.startPrefix : '')),
                end: getTimestamp(e.end),
                mins: e.mins,
                brightness: e.bestBrightness,
                brightnessText: brightnessText,
                startDir: e.startDir,
                startDirText: getDir(e.startDir),
                endDir: e.endDir,
                endDirText: getDir(e.endDir),
                startElev: e.startElev, maxElev: e.maxElev, endElev: e.endElev,
                azimuthAtMaxElev: e.azimuthAtMaxElev
            };

            timings.push(entry);
        });

        return timings;
    }

    /* fast scan */
    function getLoopInstruction(i, prevI, currTimingValid, prevTimingValid, fastForwardAllowedAfterI, samplesPerMin) {
        var loopInstruction = {
            shouldContinue: false, i: i, prevTimingValid: prevTimingValid,
            fastForwardAllowedAfterI: fastForwardAllowedAfterI
        };

        var isNormalProgression = (i === prevI + 1);
        var isRewinded = (i <= prevI);

        if (isNormalProgression === true) {
            if (prevTimingValid === true) {
                if (currTimingValid === true) {
                    // ongoing valid stretch
                    // keep going
                } else {
                    // next entry after valid stretch ended
                    // fast forward
                    if (i > fastForwardAllowedAfterI) {
                        loopInstruction.prevTimingValid = false;
                        loopInstruction.i += 3 * samplesPerMin; // increment i by 3 mins
                        loopInstruction.shouldContinue = true;
                        return loopInstruction;
                    } else {
                        // not allowed to fast forward yet
                        // keep going
                    }
                }
            } else {
                if (currTimingValid === true) {
                    // first entry in valid stretch
                    // keep going
                } else {
                    // not in valid stretch
                    // fast forward
                    if (i > fastForwardAllowedAfterI) {
                        loopInstruction.prevTimingValid = false;
                        loopInstruction.i += 3 * samplesPerMin; // increment i by 3 mins
                        loopInstruction.shouldContinue = true;
                        return loopInstruction;
                    } else {
                        // not allowed to fast forward yet
                        // keep going
                    }
                }
            }
        } else if (isRewinded === true) {
            if (prevTimingValid === true) {
                // invalid scenario
            } else {
                if (currTimingValid === true) {
                    // unlikely, but consider as first entry in valid stretch
                    // keep going
                } else {
                    // do nothing, keep going
                }
            }
        } else {
            // is fast forwarded
            if (prevTimingValid === true) {
                // invalid scenario
            } else {
                if (currTimingValid === true) {
                    // fast-forwarded into a valid stretch
                    // rewind 3 mins
                    loopInstruction.prevTimingValid = false;
                    loopInstruction.fastForwardAllowedAfterI = i;
                    loopInstruction.i -= 3 * samplesPerMin; // decrement i by 3 mins
                    loopInstruction.shouldContinue = true;
                    return loopInstruction;
                } else {
                    // not in valid stretch
                    // fast forward
                    if (i > fastForwardAllowedAfterI) {
                        loopInstruction.prevTimingValid = false;
                        loopInstruction.i += 3 * samplesPerMin; // increment i by 3 mins
                        loopInstruction.shouldContinue = true;
                        return loopInstruction;
                    } else {
                        // not allowed to fast forward yet
                        // keep going
                    }
                }
            }
        }

        loopInstruction.prevTimingValid = currTimingValid;

        if (currTimingValid === false) {
            loopInstruction.shouldContinue = true;
        }

        return loopInstruction;
    }

    /* orbit utils */
    function isEclipsed(satXYZ, sunXYZ) {
        var a = vec_mag(sunXYZ);
        var b = vec_mag(satXYZ);
        var sat_to_sun = vec_diff(sunXYZ, satXYZ);
        var c = vec_mag(sat_to_sun);

        var phase_angle = Math.acos((Math.pow(b, 2) + Math.pow(c, 2) - Math.pow(a, 2)) / (2 * b * c));
        var R_e = EARTH_RADIUS
        var R_s = SUN_RADIUS
        var pE = b
        var pS = c

        var theta_e = Math.asin(R_e / pE)
        var theta_s = Math.asin(R_s / pS)

        var full_eclipse = ((theta_e > theta_s) && (phase_angle < (theta_e - theta_s)))
        var partial_eclipse = (Math.abs(theta_e - theta_s) < phase_angle) && (phase_angle < (theta_e + theta_s))

        return full_eclipse || partial_eclipse
    }

    function getBrightness(date, latitude, longitude, lookAngles, stdMag) {
        var sunPos = SunCalc.getPosition(date, latitude, longitude);
        sunPos.azimuth += Math.PI; // SunCalc's 0 is south, satellite-js's 0 is north
        sunPos.elevation = sunPos.altitude;

        var cosDelta = Math.sin(lookAngles.elevation) * Math.sin(sunPos.elevation)
            + Math.cos(lookAngles.elevation) * Math.cos(sunPos.elevation) * Math.cos(lookAngles.azimuth - sunPos.azimuth);
        var angleC = Math.acos(cosDelta);

        var a = SUN_TO_EARTH_DIST - EARTH_RADIUS - SUN_RADIUS; // # Km
        var b = lookAngles.distance;
        var c = Math.sqrt(Math.pow(a, 2) + Math.pow(b, 2) - 2 * a * b * Math.cos(angleC));

        var phaseAngle = Math.acos((Math.pow(b, 2) + Math.pow(c, 2) - Math.pow(a, 2)) / (2 * b * c));

        // calc magnitude
        var term1 = stdMag;
        var term2 = 5.0 * Math.log10(b / 1000);

        var arg = Math.sin(phaseAngle) + (Math.PI - phaseAngle) * Math.cos(phaseAngle);
        var term3 = -2.5 * Math.log10(arg);

        var apparentMag = term1 + term2 + term3;

        return [apparentMag, satellite.radiansToDegrees(sunPos.azimuth), satellite.radiansToDegrees(sunPos.altitude)];
    }

    function getSunPosition(date) {
        var rad = Math.PI / 180;
        var jd = satellite.jday(date);
        var t = (jd - 2451545.0) / 36525;
        var mean_longitude = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
        var mean_anomaly = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
        var eccentricity = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t;
        var equation = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(mean_anomaly * rad);
        equation += (0.019993 - 0.000101 * t) * Math.sin(2 * mean_anomaly * rad);
        equation += 0.000289 * Math.sin(3 * mean_anomaly * rad);
        var true_longitude = mean_longitude + equation;
        var true_anomary = mean_anomaly + equation;
        var radius = (1.000001018 * (1 - eccentricity * eccentricity)) / (1 + eccentricity * Math.cos(true_anomary * rad));
        var nao = new NutationAndObliquity(date)
        var nutation = nao.nutation();
        var obliquity = nao.obliquity();
        var apparent_longitude = true_longitude + nutation;
        var longitude = apparent_longitude;
        var distance = radius * 149597870.691;

        var x = distance * Math.cos(longitude * rad);
        var y = distance * (Math.sin(longitude * rad) * Math.cos(obliquity * rad));
        var z = distance * (Math.sin(longitude * rad) * Math.sin(obliquity * rad));

        return { x: x, y: y, z: z };
    }

    function NutationAndObliquity(date) {
        var rad = Math.PI / 180;
        var jd = satellite.jday(date)
        var t = (jd - 2451545.0) / 36525;
        var omega = (125.04452 - 1934.136261 * t + 0.0020708 * t * t + (t * t + t) / 450000) * rad;
        var L0 = (280.4665 + 36000.7698 * t) * rad
        var L1 = (218.3165 + 481267.8813 * t) * rad
        return {
            nutation: function () {
                var nutation = (-17.20 / 3600) * Math.sin(omega) - (-1.32 / 3600) * Math.sin(2 * L0) - (0.23 / 3600) * Math.sin(2 * L1) + (0.21 / 3600) * Math.sin(2 * omega) / rad;
                return nutation;
            },
            obliquity: function () {
                var obliquity_zero = 23 + 26.0 / 60 + 21.448 / 3600 - (46.8150 / 3600) * t - (0.00059 / 3600) * t * t + (0.001813 / 3600) * t * t * t;
                var obliquity_delta = (9.20 / 3600) * Math.cos(omega) + (0.57 / 3600) * Math.cos(2 * L0) + (0.10 / 3600) * Math.cos(2 * L1) - (0.09 / 3600) * Math.cos(2 * omega);
                var obliquity = obliquity_zero + obliquity_delta;
                return obliquity;
            }
        }
    }

    function vec_mag(v) {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }

    function vec_diff(v0, v1) {
        return { x: v0.x - v1.x, y: v0.y - v1.y, z: v0.z - v1.z };
    }

    /* general utils */
    function normalizeMoment(m, timezone) {
        var newM = moment().tz(timezone);
        newM.hour(m.hour());
        newM.minute(m.minute());
        newM.second(m.second());

        return newM;
    }

    function ensureSatrec(sat) {
        if (sat.satrec === undefined) {
            sat.satrec = satellite.json2satrec(sat.omm);
        }

        return sat.satrec;
    }

    function propagateSatrec(satrec, date) {
        var positionAndVelocity = satellite.propagate(satrec, date);

        if (positionAndVelocity === null || positionAndVelocity.position === undefined) {
            return null;
        }

        return positionAndVelocity;
    }

    function getPropagationBaseDate(sat, satrec) {
        var currentDate = new Date();

        if (propagateSatrec(satrec, currentDate) !== null) {
            return currentDate;
        }

        return getElementDate(sat);
    }

    function getElementDate(sat) {
        var epochMs = Date.parse(sat.omm.EPOCH);

        if (Number.isNaN(epochMs)) {
            throw new Error('Invalid OMM epoch');
        }

        return new Date(epochMs);
    }

    function getElementEpoch(sat) {
        return Math.floor(getElementDate(sat).getTime() / 1000);
    }

    function getTimestamp(m, prefix) {
        prefix = (prefix === undefined ? '' : prefix);
        return { time: prefix + m.format('h:mm a'), date: m.format('D MMM YYYY'), epoch: m.unix() };
    }

    function getDir(az) {
        var dir = '';
        if (az >= 337 || az < 22) {
            dir = 'north';
        } else if (az >= 292 && az < 337) {
            dir = 'northwest';
        } else if (az >= 247 && az < 292) {
            dir = 'west';
        } else if (az >= 202 && az < 247) {
            dir = 'southwest';
        } else if (az >= 157 && az < 202) {
            dir = 'south';
        } else if (az >= 112 && az < 157) {
            dir = 'southeast';
        } else if (az >= 67 && az < 112) {
            dir = 'east';
        } else if (az >= 22 && az < 67) {
            dir = 'northeast';
        } else {
            dir = 'north';
        }

        return dir;
    }
}