.PHONY: setup status ingest db model export all test clean

PY ?= python

setup:
	$(PY) -m pip install -e ".[dev]"

status:
	$(PY) -m fantaoracle status

# Raccolta da tutte le fonti. Le pagine delle stagioni concluse restano in cache.
ingest:
	$(PY) -m fantaoracle ingest

# Ricostruisce data/fantaoracle.duckdb dagli snapshot in data/raw.
db:
	$(PY) -m fantaoracle db

# Proiezioni, valore e prezzo atteso.
model:
	$(PY) -m fantaoracle model

# Dati per il tool web in src/web/data.json.
export:
	$(PY) -m fantaoracle export

# Tutta la pipeline: ingest -> db -> model -> export.
all:
	$(PY) -m fantaoracle all

test:
	$(PY) -m pytest tests -q

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
