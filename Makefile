.PHONY: setup status ingest db model export all test clean

PY ?= python

setup:
	$(PY) -m pip install -e ".[dev]"

status:
	$(PY) -m fantaorb status

# Raccolta da tutte le fonti. Le pagine delle stagioni concluse restano in cache.
ingest:
	$(PY) -m fantaorb ingest

# Ricostruisce data/fantaorb.duckdb dagli snapshot in data/raw.
db:
	$(PY) -m fantaorb db

# Proiezioni, valore e prezzo atteso.
model:
	$(PY) -m fantaorb model

# Dati per il tool web in web/data.json.
export:
	$(PY) -m fantaorb export

# Tutta la pipeline: ingest -> db -> model -> export.
all:
	$(PY) -m fantaorb all

test:
	$(PY) -m pytest tests -q

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
