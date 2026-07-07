# Makefile — custom build per funzioni Lambda con dipendenze cross-cartella.
#
# PkManagerFunction (template.yaml) usa `Metadata: BuildMethod: makefile`
# perché PkManager.js richiede il codice sorgente di pkEper/pkDocsoa/pkMenupricing
# tramite path relativi (../pkEper/..., ecc.). SAM non può quindi limitarsi a
# impacchettare solo la cartella pkManager/: il target sottostante ricrea, dentro
# $(ARTIFACTS_DIR), la stessa struttura di cartelle presente nel repository
# (pkManager/, pkEper/, pkDocsoa/, pkMenupricing/ come sibling), così che
# require(path.resolve(__dirname, '../pkEper/...')) continui a risolvere
# correttamente anche a runtime in Lambda.
#
# Prerequisito: ogni modulo (pkManager, pkEper, pkDocsoa, pkMenupricing) deve
# avere già eseguito `npm ci --omit=dev` (vedi step CI "Install npm dependencies")
# prima che `sam build` invochi questo target.

build-PkManagerFunction:
	mkdir -p "$(ARTIFACTS_DIR)/pkManager" "$(ARTIFACTS_DIR)/pkEper" "$(ARTIFACTS_DIR)/pkDocsoa" "$(ARTIFACTS_DIR)/pkMenupricing"
	cp -r pkManager/. "$(ARTIFACTS_DIR)/pkManager/"
	cp -r pkEper/. "$(ARTIFACTS_DIR)/pkEper/"
	cp -r pkDocsoa/. "$(ARTIFACTS_DIR)/pkDocsoa/"
	cp -r pkMenupricing/. "$(ARTIFACTS_DIR)/pkMenupricing/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/pkManager/__tests__ "$(ARTIFACTS_DIR)"/pkManager/coverage "$(ARTIFACTS_DIR)"/pkManager/.env* \
		"$(ARTIFACTS_DIR)"/pkEper/__tests__ "$(ARTIFACTS_DIR)"/pkEper/coverage "$(ARTIFACTS_DIR)"/pkEper/.env* "$(ARTIFACTS_DIR)"/pkEper/test.js \
		"$(ARTIFACTS_DIR)"/pkDocsoa/__tests__ "$(ARTIFACTS_DIR)"/pkDocsoa/coverage "$(ARTIFACTS_DIR)"/pkDocsoa/.env* \
		"$(ARTIFACTS_DIR)"/pkMenupricing/__tests__ "$(ARTIFACTS_DIR)"/pkMenupricing/coverage "$(ARTIFACTS_DIR)"/pkMenupricing/.env*
