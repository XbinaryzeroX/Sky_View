// Fixed airline status links open only when the user chooses them.
export const airlineStatusPages: Readonly<Record<string, [string, string]>> = {
  IBE: ['Iberia', 'https://www.iberia.com/us/flight-status/'],
  ANE: ['Iberia Regional', 'https://www.iberia.com/us/flight-status/'],
  BAW: ['British Airways', 'https://www.britishairways.com/travel/flightstatus/public/en_us/search/'],
  ANZ: ['Air New Zealand', 'https://www.airnewzealand.com/arrivals-and-departures'],
  AAL: ['American Airlines', 'https://www.aa.com/travelInformation/flights/status'],
  DAL: ['Delta', 'https://www.delta.com/flightstatus/search'],
  UAL: ['United', 'https://www.united.com/en/us/flightstatus'],
  DLH: ['Lufthansa', 'https://www.lufthansa.com/de/en/timetable-and-flight-status'],
};
