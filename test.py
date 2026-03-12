import requests

url = "https://opensky-network.org/api/states/all?lamin=6&lomin=68&lamax=37&lomax=97"

r = requests.get(url)

print(r.json())