# Makefile — custom build per funzioni Lambda con dipendenze cross-cartella.
#
# PkManagerFunction (template.yaml) usa `Metadata: BuildMethod: makefile`
# perché PkManager.js richiede il codice sorgente di pkEper/pkDocsoa/pkMenupricing/dms
# tramite path relativi (../pkEper/..., ../dms/..., ecc.). SAM non può quindi limitarsi a
# impacchettare solo la cartella pkManager/: il target sottostante ricrea, dentro
# $(ARTIFACTS_DIR), la stessa struttura di cartelle presente nel repository
# (pkManager/, pkEper/, pkDocsoa/, pkMenupricing/, dms/ come sibling), così che
# require(path.resolve(__dirname, '../pkEper/...')) continui a risolvere
# correttamente anche a runtime in Lambda.
#
# Prerequisito: ogni modulo (pkManager, pkEper, pkDocsoa, pkMenupricing, dms) deve
# avere già eseguito `npm ci --omit=dev` (vedi step CI "Install npm dependencies")
# prima che `sam build` invochi questo target.

build-PkManagerFunction:
	mkdir -p "$(ARTIFACTS_DIR)/pkManager" "$(ARTIFACTS_DIR)/pkEper" "$(ARTIFACTS_DIR)/pkDocsoa" "$(ARTIFACTS_DIR)/pkMenupricing" "$(ARTIFACTS_DIR)/dms"
	cp -r pkManager/. "$(ARTIFACTS_DIR)/pkManager/"
	cp -r pkEper/. "$(ARTIFACTS_DIR)/pkEper/"
	cp -r pkDocsoa/. "$(ARTIFACTS_DIR)/pkDocsoa/"
	cp -r pkMenupricing/. "$(ARTIFACTS_DIR)/pkMenupricing/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/pkManager/__tests__ "$(ARTIFACTS_DIR)"/pkManager/coverage "$(ARTIFACTS_DIR)"/pkManager/.env* \
		"$(ARTIFACTS_DIR)"/pkEper/__tests__ "$(ARTIFACTS_DIR)"/pkEper/coverage "$(ARTIFACTS_DIR)"/pkEper/.env* "$(ARTIFACTS_DIR)"/pkEper/test.js \
		"$(ARTIFACTS_DIR)"/pkDocsoa/__tests__ "$(ARTIFACTS_DIR)"/pkDocsoa/coverage "$(ARTIFACTS_DIR)"/pkDocsoa/.env* \
		"$(ARTIFACTS_DIR)"/pkMenupricing/__tests__ "$(ARTIFACTS_DIR)"/pkMenupricing/coverage "$(ARTIFACTS_DIR)"/pkMenupricing/.env* \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md

# SessionFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché, per il
# flusso evolutivo "username -> myPeople -> dms/settings", session/src/repositories/
# myPeopleDmsSessionRepository.js richiede il codice sorgente di myPeople/dms tramite
# path relativi (../../../myPeople/..., ../../../dms/...): stesso identico motivo/pattern
# di PkManagerFunction sopra.
build-SessionFunction:
	mkdir -p "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/dms"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md
