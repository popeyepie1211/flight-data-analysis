import boto3
import requests
import json
import time
import os
import logging
from datetime import datetime
from botocore.exceptions import ClientError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ==========================
# Configuration
# ==========================

STREAM_NAME = os.getenv("KINESIS_STREAM", "flight-data-stream")  
REGION = os.getenv("AWS_REGION", "ap-south-1") 

POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# India bounding box
LAT_MIN = 6
LAT_MAX = 37
LON_MIN = 68
LON_MAX = 97

OPENSKY_API = (
    f"https://opensky-network.org/api/states/all?"
    f"lamin={LAT_MIN}&lomin={LON_MIN}&lamax={LAT_MAX}&lomax={LON_MAX}"
)

USERNAME = os.getenv("OPENSKY_USERNAME")
PASSWORD = os.getenv("OPENSKY_PASSWORD")

# ==========================
# Logging
# ==========================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)

logger = logging.getLogger("flight-producer")

# ==========================
# AWS Client
# ==========================

kinesis_client = boto3.client(
    "kinesis",
    region_name=REGION
)

# ==========================
# HTTP Session with retries
# ==========================

session = requests.Session()

# Define retry strategy for transient errors ...what this does is it will retry the request up to 3 times with an exponential backoff if it encounters certain HTTP status codes that indicate temporary issues (like rate limiting or server errors). This helps make the producer more resilient to network hiccups or API rate limits.
retry_strategy = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504]
)

adapter = HTTPAdapter(max_retries=retry_strategy)   # Mount the adapter to both HTTP and HTTPS

session.mount("https://", adapter)    # Mount for HTTPS, which is the current API endpoint
session.mount("http://", adapter)  # In case the API endpoint changes to HTTP in the future

# ==========================
# Fetch flight data
# ==========================

def fetch_flights():

    try:

        auth = None
        if USERNAME and PASSWORD:
            auth = (USERNAME, PASSWORD)

        response = session.get(
            OPENSKY_API,
            auth=auth,
            timeout=10
        )

        response.raise_for_status()  # Raise error for bad status codes

        data = response.json()

        if not data.get("states"):
            return []

        flights = []

        for state in data["states"]:

            if state[5] is None or state[6] is None:
                continue

            flight = {

                "icao24": state[0],
                "callsign": (state[1] or "").strip(),
                "country": state[2],

                "longitude": state[5],
                "latitude": state[6],

                "altitude": state[7],
                "velocity": state[9],

                "vertical_rate": state[11], 
                "on_ground": state[8],

                "last_contact": state[4],

                "timestamp": datetime.utcnow().isoformat() 
            }

            flights.append(flight)

        return flights

    except Exception as e:

        logger.error(f"Flight fetch error: {e}")
        return []

# ==========================
# Transform data
# ==========================

def transform_flight(flight):

    try:

        speed_kmh = None

        if flight["velocity"]:
            speed_kmh = round(flight["velocity"] * 3.6, 2)

        altitude_category = "unknown"

        if flight["altitude"]:
            if flight["altitude"] < 1000:
                altitude_category = "low"
            elif flight["altitude"] < 10000:
                altitude_category = "medium"
            else:
                altitude_category = "cruising"

        flight["speed_kmh"] = speed_kmh
        flight["altitude_category"] = altitude_category

        return flight

    except Exception as e:

        logger.warning(f"Transform error {e}")
        return None

# ==========================
# Send to Kinesis (batch)
# ==========================

def send_to_kinesis(records):

    try:

        entries = []

        for record in records:

            entries.append({
                "Data": json.dumps(record),
                "PartitionKey": record["icao24"]
            })

        # Kinesis max batch size = 500
        for i in range(0, len(entries), 500):

            batch = entries[i:i+500]

            response = kinesis_client.put_records(
                StreamName=STREAM_NAME,
                Records=batch
            )

            failed = response["FailedRecordCount"]

            if failed > 0:
                logger.warning(f"{failed} records failed to send")

    except ClientError as e:

        logger.error(f"Kinesis error {e}")

# ==========================
# Producer Loop
# ==========================

def run_producer():

    logger.info("Starting flight data producer")

    while True:

        try:

            flights = fetch_flights()

            if not flights:
                logger.info("No flights found")
                time.sleep(POLL_INTERVAL)
                continue

            transformed = []

            for flight in flights:

                t = transform_flight(flight)

                if t:
                    transformed.append(t)

            logger.info(f"Flights fetched: {len(transformed)}")

            send_to_kinesis(transformed)

            logger.info("Data sent to Kinesis")

        except Exception as e:

            logger.error(f"Producer error: {e}")

        time.sleep(POLL_INTERVAL)

# ==========================
# Entry Point
# ==========================

if __name__ == "__main__":

    try:
        run_producer()

    except KeyboardInterrupt:
        logger.info("Producer stopped")