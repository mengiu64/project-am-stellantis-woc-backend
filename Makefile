# Makefile — custom build per funzioni Lambda con dipendenze cross-cartella.
#
# PkManagerFunction (template.yaml) usa `Metadata: BuildMethod: makefile`
# perché PkManager.js richiede il codice sorgente di pkEper/pkDocsoa/pkMenupricing/dms/
# dbManager tramite path relativi (../pkEper/..., ../dms/..., ../dbManager/..., ecc.).
# SAM non può quindi limitarsi a impacchettare solo la cartella pkManager/: il target
# sottostante ricrea, dentro $(ARTIFACTS_DIR), la stessa struttura di cartelle presente
# nel repository (pkManager/, pkEper/, pkDocsoa/, pkMenupricing/, dms/, dbManager/ come
# sibling), così che require(path.resolve(__dirname, '../pkEper/...')) continui a
# risolvere correttamente anche a runtime in Lambda.
#
# IMPORTANTE: `sam build` con BuildMethod: makefile copia CodeUri (rispettando
# .samignore) in una directory di staging PRIMA di invocare questo Makefile — e per
# funzioni Runtime: nodejs* la SAM CLI esclude per default node_modules/ da quella
# copia iniziale (si aspetta che il builder reinstalli le dipendenze). Per questo
# NON basta che ogni modulo abbia già eseguito `npm ci --omit=dev` nel repository
# sorgente prima di `sam build`: il target deve reinstallare le dipendenze DENTRO
# $(ARTIFACTS_DIR) dopo la copia, altrimenti node_modules (es. "pg" per dbManager)
# risulta assente a runtime ("Cannot find module 'pg'") pur essendo presente il
# codice sorgente (package.json/package-lock.json sopravvivono alla copia, node_modules no).
npm-ci-prod = (cd "$(1)" && npm ci --omit=dev --no-audit --no-fund)

build-PkManagerFunction:
	mkdir -p "$(ARTIFACTS_DIR)/pkManager" "$(ARTIFACTS_DIR)/pkEper" "$(ARTIFACTS_DIR)/pkDocsoa" "$(ARTIFACTS_DIR)/pkMenupricing" "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dbManager"
	cp -r pkManager/. "$(ARTIFACTS_DIR)/pkManager/"
	cp -r pkEper/. "$(ARTIFACTS_DIR)/pkEper/"
	cp -r pkDocsoa/. "$(ARTIFACTS_DIR)/pkDocsoa/"
	cp -r pkMenupricing/. "$(ARTIFACTS_DIR)/pkMenupricing/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/pkManager/__tests__ "$(ARTIFACTS_DIR)"/pkManager/coverage "$(ARTIFACTS_DIR)"/pkManager/.env* \
		"$(ARTIFACTS_DIR)"/pkEper/__tests__ "$(ARTIFACTS_DIR)"/pkEper/coverage "$(ARTIFACTS_DIR)"/pkEper/.env* "$(ARTIFACTS_DIR)"/pkEper/test.js \
		"$(ARTIFACTS_DIR)"/pkDocsoa/__tests__ "$(ARTIFACTS_DIR)"/pkDocsoa/coverage "$(ARTIFACTS_DIR)"/pkDocsoa/.env* \
		"$(ARTIFACTS_DIR)"/pkMenupricing/__tests__ "$(ARTIFACTS_DIR)"/pkMenupricing/coverage "$(ARTIFACTS_DIR)"/pkMenupricing/.env* \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env*
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkEper)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkDocsoa)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkMenupricing)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)

# SessionFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché, per il
# flusso evolutivo "username -> myPeople -> dms/settings", session/src/repositories/
# myPeopleDmsSessionRepository.js richiede il codice sorgente di myPeople/dms tramite
# path relativi (../../../myPeople/..., ../../../dms/...): stesso identico motivo/pattern
# di PkManagerFunction sopra. Include anche dmlConfigSync/ (db.js + DmlConfigRepository.js)
# perché la stessa repository legge la cache company-types/customer-titles (tabella
# woc.dml_configurations) tramite require(path.resolve(__dirname, '../../../dmlConfigSync/...')).
build-SessionFunction:
	mkdir -p "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dmlConfigSync"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/session)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/myPeople)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)

# PkFavoriteFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché,
# per l'arricchimento dei preferiti in GET (una chiamata al gateway DML per ciascun
# codice pacchetto preferito, MessageType LFP), pkFavorite/index.js richiede il
# codice sorgente di dms tramite path relativi (../dms/authService, ../dms/dmsService):
# stesso identico motivo/pattern di PkManagerFunction/SessionFunction sopra.
build-PkFavoriteFunction:
	mkdir -p "$(ARTIFACTS_DIR)/pkFavorite" "$(ARTIFACTS_DIR)/dms"
	cp -r pkFavorite/. "$(ARTIFACTS_DIR)/pkFavorite/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/pkFavorite/__tests__ "$(ARTIFACTS_DIR)"/pkFavorite/coverage "$(ARTIFACTS_DIR)"/pkFavorite/.env* \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkFavorite)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)

# JobCardFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché,
# per il flusso di arricchimento prezzo/disponibilità del carrello
# (jobCardService.js::getCartPriceAndAvailability), jobcard/jobCardService.js
# richiede il codice sorgente di dms tramite path relativi (../dms/authService,
# ../dms/dmsService): stesso identico motivo/pattern di
# PkManagerFunction/SessionFunction/PkFavoriteFunction sopra.
build-JobCardFunction:
	mkdir -p "$(ARTIFACTS_DIR)/jobcard" "$(ARTIFACTS_DIR)/dms"
	cp -r jobcard/. "$(ARTIFACTS_DIR)/jobcard/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/jobcard/__tests__ "$(ARTIFACTS_DIR)"/jobcard/coverage "$(ARTIFACTS_DIR)"/jobcard/.env* \
		"$(ARTIFACTS_DIR)"/jobcard/testCart.js "$(ARTIFACTS_DIR)"/jobcard/jobCardDetail-sample.json \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/jobcard)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)

# DmlConfigSyncFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché
# dmlConfigSync/index.js richiede il codice sorgente di dms tramite path relativi
# (../dms/authService, ../dms/dmsService) per chiamare company-types/customer-titles
# per ciascun mercato abilitato: stesso identico motivo/pattern di
# PkManagerFunction/SessionFunction/PkFavoriteFunction/JobCardFunction sopra.
build-DmlConfigSyncFunction:
	mkdir -p "$(ARTIFACTS_DIR)/dmlConfigSync" "$(ARTIFACTS_DIR)/dms"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
