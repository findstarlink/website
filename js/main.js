/*
Dependencies:
 - require('sat-timings')
   - require('suncalc')
   - require('moment-timezone')
   - require('tz-lookup')
   - require('satellite.js')
 - require('locations.js')
 - require('jscookie')
 - require('sat-data.js') // contains satellite data
*/

function getActiveSats() {
	if (SAT_DATA === undefined || SAT_DATA.satellites === undefined) {
		return [];
	}

	return SAT_DATA.satellites.filter(function (sat) {
		return (sat.active === true);
	});
}

var MAX_AUTOCOMPLETE_ENTRIES = 5;
var MAX_RECENT_ENTRIES = 3;

/* prepare cities data */
var countriesSorted = [];
countries.forEach(function (c, i) {
	countriesSorted.push([c, i]);
});
countriesSorted.sort(function (a, b) { return (b[0] > a[0] ? -1 : 1) });
countriesSorted.push(['custom', -1]);

countriesSorted = countriesSorted.map(function (e) {
	return '<option value="' + e[1] + '">' + e[0] + '</option>';
});
var countriesHtml = countriesSorted.join('');
document.getElementById('countrySelection').innerHTML = countriesHtml;

cities.forEach(function (e, i) { e.push(i); });
cities.sort(function (a, b) { return b[1] - a[1] });
cities.forEach(function (e, i) { e.push(i); });

/* objs */
var predictor = new SkyPredictor();
var ui = new UIManager();
var observer = {}; // in degrees

function SkyPredictor() {
	/* consts */
	var DAYS_COUNT = 5;

	/* scratchpad */
	var satTimings = new StarlinkSatTimings();

	/* entry point */
	this.showVisibleTimes = function () {
		var citypicker = jQ('.citypicker');
		jQ('body').append(citypicker);
		citypicker.hide();

		var noVisibilityReminderNudge = jQ("#noVisibilityReminderNudge");
		jQ('body').append(noVisibilityReminderNudge);
		noVisibilityReminderNudge.hide();

		var results = getTimings();
		renderResults(results);
	}

	this.getSatellitePath = function (sat, mins) {
		return satTimings.getSatellitePath(sat, mins);
	}

	this.getCurrentSatelliteCoords = function (sat) {
		return satTimings.getCurrentSatelliteCoords(sat);
	}

	function getTimings() {
		var sats = getActiveSats();

		var results = undefined;
		var opts = {
			apiVersion: "1.1",
			daysCount: DAYS_COUNT,
			timeOfDay: Tracker.TimeOfDay.value,
			startDaysOffset: (parseInt(Tracker.StartDaysOffset.value) - 1)
		};

		sats.forEach(function (sat) {
			try {
				var res = satTimings.getVisibleTimes(sat, observer.latitude, observer.longitude, opts);

				if (results === undefined) {
					results = res;
				} else {
					results.timings.push.apply(results.timings, res.timings);
				}
			} catch (e) {
				console.log('unable to calculate timing for ', sat.name, e);
			}
		});

		function timeSorter(a, b) {
			return a.start.epoch - b.start.epoch; // compares unix time of each
		}

		results.timings = results.timings.sort(timeSorter);

		return results;
	}

	function renderResults(results) {
		var o = document.getElementById('visibilityInfo');
		var footer = document.getElementById('footer');

		var sats = getActiveSats();
		var latestSat = sats[0];

		var locationStr = "";
		var hashUrl = "";
		var locationId = "";
		var destination = "";

		if (observer.id === undefined) {
			locationStr = Tracker.LatitudeDegrees.value + "&deg; " + Tracker.LatitudeDirection.value + ", " +
				Tracker.LongitudeDegrees.value + "&deg; " + Tracker.LongitudeDirection.value;

			hashUrl = Tracker.LatitudeDegrees.value + "," + Tracker.LatitudeDirection.value + "," +
				Tracker.LongitudeDegrees.value + "," + Tracker.LongitudeDirection.value;

			if (ui.nameOverride !== "") {
				locationStr = decodeURIComponent(ui.nameOverride);
			}
		} else {
			var locId = observer.id;
			locationStr = observer.name;

			hashUrl = locId;
		}

		locationId = hashUrl;
		jQ("#LOCATION").val(locationId); // used for subscribe form hidden field

		if (Tracker.Days.value === "3") {
			hashUrl += ";3";
		}

		if (ui.nameOverride !== "") {
			hashUrl += ";" + ui.nameOverride;
		}

		window.location.hash = hashUrl;

		/* -- new rendering -- */
		var resultsMeta = jQ('#resultsMeta');
		var metaInfo = jQ('#resultsMetaTemplate .metaInfo').clone();

		ui.printf(metaInfo, '#resultsPlaceName', 'placeName', locationStr);
		ui.printf(metaInfo, '#resultsSunInfo', 'results.sunrise', results.sunrise);
		ui.printf(metaInfo, '#resultsSunInfo', 'results.sunset', results.sunset);
		ui.printf(metaInfo, '#resultsTimezone', 'results.timezoneOffset', results.timezoneOffset);
		ui.printf(metaInfo, '#resultsTimezone', 'results.timezoneOffsetText', results.timezoneOffsetText);

		resultsMeta.empty();
		metaInfo.appendTo(resultsMeta);

		var goodTimings = results.timings.filter(function (e) { return e.visibility === 'good'; });
		var avgTimings = results.timings.filter(function (e) { return e.visibility === 'average'; });
		var poorTimings = results.timings.filter(function (e) { return e.visibility === 'poor'; });

		if (goodTimings.length === 0) {
			jQ('#goodTimingsError').show();
		} else {
			jQ('#goodTimingsError').hide();
		}

		var goodTimingsRoot = jQ('#goodTimings');
		var avgTimingsRoot = jQ('#avgTimings');
		var poorTimingsRoot = jQ('#poorTimings');

		goodTimingsRoot.empty();
		avgTimingsRoot.empty();
		poorTimingsRoot.empty();

		var timingEntryTemplate = jQ('#resultTimingTemplate .timingEntry');

		function insertInto(timingRoot) {
			return function (entry) {
				var line = timingEntryTemplate.clone();

				var brightnessLabel = (entry.brightnessText === 'bright' ? 'brightLabel' : 'dimLabel');
				var newLabel = '';//(entry.name === latestSat.name ? ' <span class="newLabel">NEW</span>' : '');// ' <span class="oldLabel">OLD</span>');
				var entryTitle = entry.title + newLabel;

				ui.printf(line, '.entryTiming', 'entry.start.time', entry.start.time);
				ui.printf(line, '.entryTiming', 'entry.start.date', entry.start.date);
				ui.printf(line, '.timingEntryBottom', 'entry.title', entryTitle);
				ui.printf(line, '.timingEntryBottom', 'brightnessLabel', brightnessLabel);
				ui.printf(line, '.timingEntryBottom', 'entry.brightnessText', entry.brightnessText.toUpperCase());
				ui.printf(line, '.timingEntryBottom', 'entry.brightness', entry.brightness.toFixed(1));
				ui.printf(line, '.timingEntryBottom', 'entry.mins', entry.mins);
				ui.printf(line, '.timingEntryBottom', 'entry.startDirText', entry.startDirText.toUpperCase());
				ui.printf(line, '.timingEntryBottom', 'entry.startDir', entry.startDir.toFixed(0));
				ui.printf(line, '.timingEntryBottom', 'entry.endDirText', entry.endDirText.toUpperCase());
				ui.printf(line, '.timingEntryBottom', 'entry.endDir', entry.endDir.toFixed(0));
				ui.printf(line, '.timingEntryBottom', 'entry.startElev', entry.startElev.toFixed(0));
				ui.printf(line, '.timingEntryBottom', 'entry.maxElev', entry.maxElev.toFixed(0));
				ui.printf(line, '.timingEntryBottom', 'entry.endElev', entry.endElev.toFixed(0));

				line.find('.timingDetailsBtn').click(function () {
					line.find('.timingDetail').fadeIn('fast');
					jQ(this).remove();
					return false;
				});

				var note = line.find('.timingNote');
				var noteKey = 'note_' + entry.name;
				note.addClass(noteKey);

				try {
					if (STRINGS && STRINGS[noteKey] !== undefined) {
						note.html(STRINGS[noteKey]).show();
					} else {
						note.hide();
					}
				} catch (e) {
					note.hide();
				}

				line.appendTo(timingRoot);
			}
		}

		goodTimings.forEach(insertInto(goodTimingsRoot));

		if (avgTimings.length > 0) {
			jQ('#avgTimingsBlock').show();
			avgTimings.forEach(insertInto(avgTimingsRoot));
		} else {
			jQ('#avgTimingsBlock').hide();
		}

		if (poorTimings.length > 0) {
			jQ('#poorTimingsBlock').show();
			poorTimings.forEach(insertInto(poorTimingsRoot));
		} else {
			jQ('#poorTimingsBlock').hide();
		}

		// latest missing nudge
		var foundGoodStarlink = goodTimings.find(function (e) { return (e.name === latestSat.name) });
		var showSubscribeNudge = (foundGoodStarlink === undefined);
		ui.showVisibilitySubscribeNudge(showSubscribeNudge);

		// share links
		if (ui.latLngDirty) {
			destination = window.location.hash;
		} else {
			destination = locationStr;
		}

		var pageUrl = [location.protocol, '//', location.host, location.pathname + location.hash].join('');

		var shareURL = encodeURIComponent(pageUrl);
		var twitterURL = 'https://twitter.com/intent/tweet?url=' + shareURL + '&text=' + encodeURIComponent('Check out when Starlink will be visible in ' + locationStr) + '&hashtags=starlink';
		var fbURL = 'https://www.facebook.com/sharer/sharer.php?u=' + shareURL;

		jQ('#pageUrl').attr('href', pageUrl);
		jQ('#twitterURL').attr('href', twitterURL);
		jQ('#fbURL').attr('href', fbURL);

		// store
		if (results.timings.length > 0) {
			jQ('#store').show();
		} else {
			jQ('#store').hide();
		}

		gtag('event', 'search', { search_term: destination });

		showTab('#resultsTabLabel');
	}
}

function UIManager() {
	/* extern */
	this.latLngDirty = false;
	this.nameOverride = "";
	this.geolocated = false;
	this.entryCount = 0;

	this.showVisibilitySubscribeNudge = function (show) {
		if (show === true) {
			var noVisibilityReminderNudge = jQ("#noVisibilityReminderNudge");
			jQ("#noVisibilityNudgeSlot").append(noVisibilityReminderNudge);
			noVisibilityReminderNudge.fadeIn();

			gtag('event', 'signup_nudge');
		} else {
			jQ("#noVisibilityReminderNudge").hide();
		}
	}

	this.printf = function (root, selector, key, text) {
		var el = root.find(selector);
		var s = el.html();
		s = s.replace('{' + key + '}', text);
		el.html(s);
	}
}


function coordStringToFloat(lat, latDir, lng, lngDir) {
	lat = parseFloat(lat);
	lng = parseFloat(lng);

	return [
		Math.abs(lat) * (latDir == 'North' ? 1 : -1),
		Math.abs(lng) * (lngDir == 'East' ? 1 : -1)
	];
}

function coordFloatToString(lat, lng) {
	lat = parseFloat(lat);
	lng = parseFloat(lng);

	return [
		Math.abs(lat),
		(lat > 0 ? 'North' : 'South'),
		Math.abs(lng),
		(lng > 0 ? 'East' : 'West')
	];
}


/* --- */
function setLatLngDirty(state) {
	ui.latLngDirty = state;
	if (state) {
		Tracker.Country.value = -1;
		Tracker.Position.value = '';
	}
	// console.log('set dirry', state);
}

function processLocationData(res) {
	console.log("Local location", res);

	if (hasLastSearch()) {
		return;
	}

	if (res.longitude === undefined || res.longitude === null || res.longitude === "") {
		return;
	}

	var mlat = parseFloat(res.latitude);
	var mlng = parseFloat(res.longitude);

	var closestDist = 100000, closestIdx = -1;

	cities.forEach(function (entry, i) {
		var cityIdx = entry[2];
		var info = cityInfo[cityIdx];
		var lat = info[1];
		var lng = info[2];
		var dist = distanceInKmBetweenEarthCoordinates(lat, lng, mlat, mlng);

		if (dist < closestDist) {
			closestIdx = i;
			closestDist = dist;
		}
	});

	if (closestIdx !== -1) {
		console.log("Closest city found to be ", cities[closestIdx][0], closestIdx, closestDist + 'km');

		if (closestDist < 40) { // within 40km of a known city
			setCity(closestIdx);

			setLatLngDirty(false);
		} else {
			console.log('city too far, using coordinates');

			setCoord(mlat, mlng);

			setLatLngDirty(true);

			showTab('#byCoordsTabLabel');
		}
	}

	ui.geolocated = true;
}

function ClearNameOverride() {
	ui.nameOverride = "";
}

function parseLatLng(latStr, lngStr) {
	var latP = latStr.split(' ');
	var lngP = lngStr.split(' ');
	_Lat = parseFloat(latP[0]) * (latP[1].toLowerCase() === 'south' ? -1 : 1);
	_Long = parseFloat(lngP[0]) * (lngP[1].toLowerCase() === 'west' ? -1 : 1);

	return [_Lat, _Long];
}

function getMyCoords() {
	return [observer.latitude, observer.longitude];
}

function distanceInKmBetweenEarthCoordinates(lat1, lon1, lat2, lon2) {
	var earthRadiusKm = 6371;

	var dLat = satellite.degreesToRadians(lat2 - lat1);
	var dLon = satellite.degreesToRadians(lon2 - lon1);

	lat1 = satellite.degreesToRadians(lat1);
	lat2 = satellite.degreesToRadians(lat2);

	var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return earthRadiusKm * c;
}

function onShare(network) {
	return function (e) {
		gtag('event', 'share', { method: network });
	};
}

function onClosure(network) {
	return function (e) {
		gtag('event', 'sign_up', { method: network });
	};
}

function hasLastSearch() {
	return Cookies.get('lastSearch') !== undefined && Cookies.get('lastSearch') !== '';
}

function storeLastSearch() {
	var lastSearch = '';

	if (observer.id !== undefined) { // city
		lastSearch = observer.id + '';
	} else { // coord
		lastSearch = observer.latitude + ',' + observer.longitude;
	}

	Cookies.set('lastSearch', lastSearch, { expires: 1000 });
}

function populateLastSearch() {
	if (!hasLastSearch()) {
		return;
	}

	var lastSearch = Cookies.get('lastSearch');

	if (lastSearch.indexOf(',') === -1) { // city
		lastSearch = parseInt(lastSearch);
		setCityById(lastSearch);
	} else { // coord
		var p = lastSearch.split(',');
		var lat = parseFloat(p[0]);
		var lng = parseFloat(p[1]);
		setCoord(lat, lng);

		showTab('#byCoordsTabLabel');
	}
}

function pushRecentPlace(placeStr) {
	if (placeStr === undefined || placeStr === null || placeStr.indexOf('|') === -1) {
		return;
	}

	var recentPlaces = getRecentPlacesRaw();
	if (recentPlaces.indexOf(placeStr) === -1) {
		recentPlaces.splice(0, 0, placeStr);
	}

	if (recentPlaces.length > MAX_RECENT_ENTRIES) {
		recentPlaces.splice(MAX_RECENT_ENTRIES);
	}

	recentPlaces = recentPlaces.join(',');

	Cookies.set('recentPlaces', recentPlaces, { expires: 1000 });

	populateRecentPlaces();
}

function getRecentPlacesRaw() {
	var recentPlaces = Cookies.get('recentPlaces');
	if (recentPlaces === undefined || recentPlaces === null) {
		return [];
	}
	recentPlaces = recentPlaces.split(',');

	return recentPlaces;
}

function getRecentPlaces() {
	var recentPlaces = getRecentPlacesRaw();
	recentPlaces = recentPlaces.map(function (e) {
		if (e.indexOf('|') !== -1) { // known city
			var p = e.split('|');
			var cityId = parseInt(p[1]);
			return { name: p[0], action: function () { setCityById(cityId); } };
		}

		return undefined;
	});

	return recentPlaces;
}

function populateRecentPlaces() {
	var recentPlaces = getRecentPlaces();
	if (recentPlaces !== undefined) {
		var recentEl = jQ("#recentPlaces ul");
		recentEl.empty();

		recentPlaces.forEach(function (e) {
			if (e === undefined) {
				return;
			}

			var el = jQ("<li><a href='#'>" + e.name + '</a></li>');
			el.find('a').click(function () {
				var f = e.action;
				if (typeof (f) === 'function') {
					f();

					showTimings();
				}

				return false;
			});

			recentEl.append(el);
		});
	}
}

function getFullname(name, regionId, countryId) {
	var region = (regionId !== -1 ? admin1[regionId] : '');
	var country = (countryId ? countries[countryId] : '');

	if (name === region || region === '') {
		return name + (country !== '' ? ', ' + country : '');
	} else {
		return name + ', ' + region + (country !== '' ? ', ' + country : '');
	}
}

function setCityById(cityId) { // not the array Idx, but the actual cityId
	cities.every(function (e, cityIdx) {
		var cityOffset = e[2];
		var info = cityInfo[cityOffset];
		var id = info[0];

		if (id === cityId) {
			setCity(cityIdx);
			return false;
		}

		return true;
	});
}

function setCity(cityIdx, addToRecent) { // not the actual cityId, but the array Idx
	if (cityIdx < 0 || cityIdx >= cities.length) {
		console.log('Setting invalid cityIdx: ', cityIdx);
		return;
	}

	var city = cities[cityIdx];
	var name = city[0];
	var cityOffset = city[2];
	var info = cityInfo[cityOffset];

	var id = info[0];
	var lat = info[1];
	var lng = info[2];
	var countryId = info[3];
	var regionId = info[4];

	Tracker.Country.value = countryId;
	Tracker.Position.value = getFullname(name, regionId);

	var c = coordFloatToString(lat, lng);

	Tracker.LatitudeDegrees.value = c[0].toFixed(1);
	Tracker.LatitudeDirection.value = c[1];
	Tracker.LongitudeDegrees.value = c[2].toFixed(1);
	Tracker.LongitudeDirection.value = c[3];

	observer = {
		latitude: lat,
		longitude: lng,
		name: getFullname(name, regionId, countryId),
		id: id
	};

	if (addToRecent === true) {
		pushRecentPlace(name + '|' + id);
	}
}

function setCoord(lat, lng) {
	observer = { latitude: lat, longitude: lng };

	var c = coordFloatToString(lat, lng);

	Tracker.LatitudeDegrees.value = c[0].toFixed(1);
	Tracker.LatitudeDirection.value = c[1];
	Tracker.LongitudeDegrees.value = c[2].toFixed(1);
	Tracker.LongitudeDirection.value = c[3];

	Tracker.Country.value = -1;
	Tracker.Position.value = '';
}

function searchCities(q, callback) {
	var l = [];

	var countryId = parseInt(Tracker.Country.value);

	if (countryId !== -1) {
		q = q.toLowerCase();
		var p = q.split(',');
		q = p[0].trim();

		var foundCount = 0;

		var l = cities.filter(function (city) {
			if (foundCount >= MAX_AUTOCOMPLETE_ENTRIES) {
				return false;
			}

			var name = city[0];
			var cityOffset = city[2];
			var info = cityInfo[cityOffset];
			var cityCountryId = info[3];

			if (countryId === cityCountryId && name.toLowerCase().indexOf(q) === 0) {
				foundCount++;
				return true;
			}

			return false;
		});
	}

	if (l.length === 0) {
		l = ["fail1", "fail2"];
	}

	callback(l);
}

function renderAutoComplete(item, q) {
	if (item === "fail1") { // no entries
		return '<div class="autocomplete-suggestion" data-idx="fail1">Sorry, nothing found. Please check the name!</div>';
	} else if (item === "fail2") {
		return '<div class="autocomplete-suggestion" data-idx="fail2">You can also <a href="#">put your coordinates</a> instead.</div>';
	}

	q = q.toLowerCase();
	var p = q.split(',');
	q = p[0].trim();

	q = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
	var re = new RegExp("(" + q.split(' ').join('|') + ")", "gi");

	var name = item[0];
	var cityOffset = item[2];
	var cityIdx = item[3];

	var info = cityInfo[cityOffset];
	var countryId = info[3];
	var regionId = info[4];
	var country = countries[countryId];
	var region = (regionId !== -1 ? admin1[regionId] : '');

	var fullname = '', highlightedName = '';

	if (name === region || region === '') {
		fullname = name;
		highlightedName = name.replace(re, "<b>$1</b>");
	} else {
		fullname = name + ', ' + region;
		highlightedName = name.replace(re, "<b>$1</b>") + ', ' + region;
	}

	return '<div class="autocomplete-suggestion" data-val="' + fullname + '" data-idx="' +
		cityIdx + '">' + highlightedName + '</div>';
}

function onCitySelected(e, q, item) {
	setLatLngDirty(false);
	// SetCookie();
	var el = jQ(item);
	var cityIdx = el.attr('data-idx');

	if (cityIdx === "fail1" || cityIdx === "fail2") {
		if (cityIdx === "fail2") {
			showTab('#byCoordsTabLabel');
		}

		return;
	}

	setCity(cityIdx, true);

	showTimings();
}

function onCoordUpdated() {
	var c = coordStringToFloat(Tracker.LatitudeDegrees.value, Tracker.LatitudeDirection.value,
		Tracker.LongitudeDegrees.value, Tracker.LongitudeDirection.value);

	observer = { latitude: c[0], longitude: c[1] };

	Tracker.Country.value = -1;
	Tracker.Position.value = '';
}

new autoComplete({
	selector: '#citySelection',
	minChars: 2,
	cache: false,
	source: searchCities,
	renderItem: renderAutoComplete,
	onSelect: onCitySelected
});