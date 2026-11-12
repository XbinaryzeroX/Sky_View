// ICAO aircraft type designators (ICAO Doc 8643) → manufacturer and model
// family. Used to name the model when the per-airframe registry (adsbdb.com)
// has no record or photos are off. A designator names a type family, not the
// exact variant, and the panel says so.

export const namedAircraftTypes: Readonly<Record<string, string>> = {
  // Airbus
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A337: 'Airbus A330-700L BelugaXL', A338: 'Airbus A330-800neo', A339: 'Airbus A330-900neo', A342: 'Airbus A340-200', A343: 'Airbus A340-300', A345: 'Airbus A340-500', A346: 'Airbus A340-600',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800', A306: 'Airbus A300-600', A30B: 'Airbus A300B', A310: 'Airbus A310', BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300', A400: 'Airbus A400M Atlas',
  // Boeing
  B712: 'Boeing 717-200', B721: 'Boeing 727-100', B722: 'Boeing 727-200', B732: 'Boeing 737-200', B733: 'Boeing 737-300', B734: 'Boeing 737-400', B735: 'Boeing 737-500', B736: 'Boeing 737-600', B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10', B742: 'Boeing 747-200', B743: 'Boeing 747-300', B744: 'Boeing 747-400', B748: 'Boeing 747-8', B74S: 'Boeing 747SP',
  B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR / 777F', B773: 'Boeing 777-300', B77W: 'Boeing 777-300ER', B778: 'Boeing 777-8', B779: 'Boeing 777-9',
  B788: 'Boeing 787-8 Dreamliner', B789: 'Boeing 787-9 Dreamliner', B78X: 'Boeing 787-10 Dreamliner', K35R: 'Boeing KC-135R Stratotanker', P8: 'Boeing P-8 Poseidon', E3TF: 'Boeing E-3 Sentry', C17: 'Boeing C-17 Globemaster III', KC46: 'Boeing KC-46 Pegasus',
  MD11: 'McDonnell Douglas MD-11', MD82: 'McDonnell Douglas MD-82', MD83: 'McDonnell Douglas MD-83', MD88: 'McDonnell Douglas MD-88', MD90: 'McDonnell Douglas MD-90', DC10: 'McDonnell Douglas DC-10', DC93: 'McDonnell Douglas DC-9-30',
  // Embraer
  E135: 'Embraer ERJ-135', E145: 'Embraer ERJ-145', E45X: 'Embraer ERJ-145XR', E170: 'Embraer E170', E75L: 'Embraer E175 (long wing)', E75S: 'Embraer E175 (short wing)', E190: 'Embraer E190', E195: 'Embraer E195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2',
  E35L: 'Embraer Legacy 600/650', E50P: 'Embraer Phenom 100', E55P: 'Embraer Phenom 300', E545: 'Embraer Legacy 450 / Praetor 500', E550: 'Embraer Legacy 500 / Praetor 600', E120: 'Embraer EMB 120 Brasilia', C390: 'Embraer C-390 Millennium',
  // Bombardier / Canadair / De Havilland Canada
  CRJ1: 'Bombardier CRJ100', CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000', DH8A: 'De Havilland Canada Dash 8-100', DH8B: 'De Havilland Canada Dash 8-200', DH8C: 'De Havilland Canada Dash 8-300', DH8D: 'De Havilland Canada Dash 8-400',
  DHC6: 'De Havilland Canada DHC-6 Twin Otter', DHC2: 'De Havilland Canada DHC-2 Beaver', DHC3: 'De Havilland Canada DHC-3 Otter', CL30: 'Bombardier Challenger 300/350', CL35: 'Bombardier Challenger 350', CL60: 'Bombardier Challenger 600 series', GL5T: 'Bombardier Global 5000/5500', GLEX: 'Bombardier Global Express / 6000', GL7T: 'Bombardier Global 7500',
  LJ35: 'Learjet 35', LJ45: 'Learjet 45', LJ60: 'Learjet 60', LJ75: 'Learjet 75',
  // ATR, Saab, others
  AT43: 'ATR 42-300', AT45: 'ATR 42-500', AT46: 'ATR 42-600', AT72: 'ATR 72', AT75: 'ATR 72-500', AT76: 'ATR 72-600', SF34: 'Saab 340', SB20: 'Saab 2000', F70: 'Fokker 70', F100: 'Fokker 100', B461: 'BAe 146-100', B462: 'BAe 146-200', B463: 'BAe 146-300', RJ85: 'Avro RJ85', RJ1H: 'Avro RJ100',
  SU95: 'Sukhoi Superjet 100', A148: 'Antonov An-148', AN12: 'Antonov An-12', AN26: 'Antonov An-26', A124: 'Antonov An-124 Ruslan', IL76: 'Ilyushin Il-76', T204: 'Tupolev Tu-204', C919: 'COMAC C919', AJ27: 'COMAC ARJ21',
  // Business jets
  C25A: 'Cessna Citation CJ2', C25B: 'Cessna Citation CJ3', C25C: 'Cessna Citation CJ4', C25M: 'Cessna Citation M2', C510: 'Cessna Citation Mustang', C525: 'Cessna CitationJet', C550: 'Cessna Citation II/Bravo', C560: 'Cessna Citation V/Ultra/Encore', C56X: 'Cessna Citation Excel/XLS',
  C650: 'Cessna Citation III/VI/VII', C680: 'Cessna Citation Sovereign', C68A: 'Cessna Citation Latitude', C700: 'Cessna Citation Longitude', C750: 'Cessna Citation X',
  GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V / G550', GLF6: 'Gulfstream G650', G280: 'Gulfstream G280', GA5C: 'Gulfstream G500', GA6C: 'Gulfstream G600', GA7C: 'Gulfstream G700', GA8C: 'Gulfstream G800',
  F2TH: 'Dassault Falcon 2000', F900: 'Dassault Falcon 900', FA7X: 'Dassault Falcon 7X', FA8X: 'Dassault Falcon 8X', FA50: 'Dassault Falcon 50', FA6X: 'Dassault Falcon 6X', H25B: 'Hawker 800 series', HA4T: 'Hawker 4000', PC24: 'Pilatus PC-24', HDJT: 'Honda HA-420 HondaJet', SF50: 'Cirrus SF50 Vision Jet', BE40: 'Beechcraft Beechjet 400',
  // Turboprops and piston
  PC12: 'Pilatus PC-12', PC6T: 'Pilatus PC-6 Porter', TBM7: 'Daher TBM 700', TBM8: 'Daher TBM 850', TBM9: 'Daher TBM 900 series', B350: 'Beechcraft King Air 350', BE20: 'Beechcraft King Air 200', BE9L: 'Beechcraft King Air 90', BE99: 'Beechcraft 99', B190: 'Beechcraft 1900', BE36: 'Beechcraft Bonanza 36', BE35: 'Beechcraft Bonanza 35', BE58: 'Beechcraft Baron 58',
  C208: 'Cessna 208 Caravan', C08T: 'Cessna 408 SkyCourier', C172: 'Cessna 172 Skyhawk', C182: 'Cessna 182 Skylane', C152: 'Cessna 152', C150: 'Cessna 150', C206: 'Cessna 206 Stationair', C210: 'Cessna 210 Centurion', C310: 'Cessna 310', C340: 'Cessna 340', C414: 'Cessna 414', C421: 'Cessna 421',
  SR20: 'Cirrus SR20', SR22: 'Cirrus SR22', S22T: 'Cirrus SR22T', P28A: 'Piper PA-28 Cherokee/Warrior/Archer', P28B: 'Piper PA-28 Cherokee 235/Dakota', P28R: 'Piper PA-28R Arrow', PA32: 'Piper PA-32 Saratoga', PA34: 'Piper PA-34 Seneca', PA44: 'Piper PA-44 Seminole', PA46: 'Piper PA-46 Malibu', PA31: 'Piper PA-31 Navajo', PA18: 'Piper PA-18 Super Cub', J3: 'Piper J-3 Cub',
  DA40: 'Diamond DA40', DA42: 'Diamond DA42', DA62: 'Diamond DA62', M20P: 'Mooney M20', M20T: 'Mooney M20 (turbo)', AA5: 'Grumman American AA-5', GA8: 'GippsAero GA8 Airvan', BN2P: 'Britten-Norman Islander', D228: 'Dornier 228', D328: 'Dornier 328', SW4: 'Fairchild Metro', C130: 'Lockheed C-130 Hercules', C30J: 'Lockheed Martin C-130J Super Hercules', P3: 'Lockheed P-3 Orion',
  // Helicopters
  EC35: 'Airbus Helicopters H135', EC45: 'Airbus Helicopters H145', EC30: 'Airbus Helicopters H130', EC55: 'Airbus Helicopters H155', EC75: 'Airbus Helicopters H175', AS50: 'Airbus Helicopters AS350 / H125', AS55: 'Airbus Helicopters AS355', AS65: 'Airbus Helicopters AS365 Dauphin', EC20: 'Airbus Helicopters EC120',
  B06: 'Bell 206', B407: 'Bell 407', B412: 'Bell 412', B429: 'Bell 429', B505: 'Bell 505', B212: 'Bell 212', A109: 'Leonardo AW109', A119: 'Leonardo AW119', A139: 'Leonardo AW139', A169: 'Leonardo AW169', A189: 'Leonardo AW189',
  R22: 'Robinson R22', R44: 'Robinson R44', R66: 'Robinson R66', S76: 'Sikorsky S-76', S92: 'Sikorsky S-92', H60: 'Sikorsky H-60 Black Hawk / Seahawk', H47: 'Boeing CH-47 Chinook', MD52: 'MD Helicopters MD 520N', MD60: 'MD Helicopters MD 600N', V22: 'Bell Boeing V-22 Osprey',
  // Military jets seen on ADS-B
  F16: 'General Dynamics F-16 Fighting Falcon', F18H: 'Boeing F/A-18E/F Super Hornet', F35: 'Lockheed Martin F-35 Lightning II', EUFI: 'Eurofighter Typhoon', T38: 'Northrop T-38 Talon', B52: 'Boeing B-52 Stratofortress', R135: 'Boeing RC-135', E6: 'Boeing E-6 Mercury',
};

/** Model family for an ICAO type designator, or null when not in the table. */
export function icaoTypeName(code: string | null | undefined): string | null {
  if (!code) return null;
  return namedAircraftTypes[code.trim().toUpperCase()] ?? null;
}
