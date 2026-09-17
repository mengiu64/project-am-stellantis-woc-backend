# Makefile — custom build per funzioni Lambda con dipendenze cross-cartella.
#
# PkManagerFunction (template.yaml) usa `Metadata: BuildMethod: makefile`
# perché PkManager.js richiede il codice sorgente di pkEper/pkDocsoa/pkMenupricing/dms/
# dbManager tramite path relativi (../pkEper/..., ../dms/..., ../dbManager/..., ecc.).
# SAM non può quindi limitarsi a impacchettare solo la cartella pkManager/: il target
# sottostante ricrea, dentro $(ARTIFACTS_DIR), la stessa struttura di cartelle presente
# nel repository (pkManager/, pkEper/, pkDocsoa/, pkMenupricing/, dms/, dbManager/,
# myPeople/, session/, dmlConfigSync/, v360/ come sibling), così che
# require(path.resolve(__dirname, '../pkEper/...')) continui a
# risolvere correttamente anche a runtime in Lambda.
#
# myPeople/, session/, dmlConfigSync/, v360/ sono necessari perché
# PkManager.js::_buildDmsSender chiama dms/dmsService.js::resolveDynamicSenderFields,
# che risolve dinamicamente mainSincom/market/language/dealerCountryCode tramite
# session/src/sessionContextCache.js (che a sua volta richiede myPeople/ e
# dmlConfigSync/, oltre a dbManager/ già presente) e brand tramite
# v360/v360Service.js::getCachedBrand — stesso identico meccanismo/stessi
# sibling di SessionFunction/PkFavoriteFunction/JobCardFunction (vedi sotto).
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
	mkdir -p "$(ARTIFACTS_DIR)/pkManager" "$(ARTIFACTS_DIR)/pkEper" "$(ARTIFACTS_DIR)/pkDocsoa" "$(ARTIFACTS_DIR)/pkMenupricing" "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dbManager" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/dmlConfigSync" "$(ARTIFACTS_DIR)/v360"
	cp -r pkManager/. "$(ARTIFACTS_DIR)/pkManager/"
	cp -r pkEper/. "$(ARTIFACTS_DIR)/pkEper/"
	cp -r pkDocsoa/. "$(ARTIFACTS_DIR)/pkDocsoa/"
	cp -r pkMenupricing/. "$(ARTIFACTS_DIR)/pkMenupricing/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	cp -r v360/. "$(ARTIFACTS_DIR)/v360/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/pkManager/__tests__ "$(ARTIFACTS_DIR)"/pkManager/coverage "$(ARTIFACTS_DIR)"/pkManager/.env* \
		"$(ARTIFACTS_DIR)"/pkEper/__tests__ "$(ARTIFACTS_DIR)"/pkEper/coverage "$(ARTIFACTS_DIR)"/pkEper/.env* "$(ARTIFACTS_DIR)"/pkEper/test.js \
		"$(ARTIFACTS_DIR)"/pkDocsoa/__tests__ "$(ARTIFACTS_DIR)"/pkDocsoa/coverage "$(ARTIFACTS_DIR)"/pkDocsoa/.env* \
		"$(ARTIFACTS_DIR)"/pkMenupricing/__tests__ "$(ARTIFACTS_DIR)"/pkMenupricing/coverage "$(ARTIFACTS_DIR)"/pkMenupricing/.env* \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md \
		"$(ARTIFACTS_DIR)"/v360/__tests__ "$(ARTIFACTS_DIR)"/v360/coverage "$(ARTIFACTS_DIR)"/v360/.env* "$(ARTIFACTS_DIR)"/v360/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkEper)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkDocsoa)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkMenupricing)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/myPeople)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/session)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/v360)

# SessionFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché, per il
# flusso evolutivo "username -> myPeople -> dms/settings", session/src/repositories/
# myPeopleDmsSessionRepository.js richiede il codice sorgente di myPeople/dms tramite
# path relativi (../../../myPeople/..., ../../../dms/...): stesso identico motivo/pattern
# di PkManagerFunction sopra. Include anche dmlConfigSync/ (db.js + DmlConfigRepository.js)
# perché la stessa repository legge la cache company-types/customer-titles (tabella
# woc.dml_configurations) tramite require(path.resolve(__dirname, '../../../dmlConfigSync/...')).
# Include infine dbManager/ (db.js + AnagSnowflakesRepository.js) perché la stessa
# repository risolve `marketIso` (tabella woc.ang_snowflakes) tramite
# require(path.resolve(__dirname, '../../../dbManager/...')).
build-SessionFunction:
	mkdir -p "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dmlConfigSync" "$(ARTIFACTS_DIR)/dbManager"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env*
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/session)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/myPeople)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)

# PkFavoriteFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché,
# per l'arricchimento dei preferiti in GET (una chiamata al gateway DML per ciascun
# codice pacchetto preferito, MessageType LFP), pkFavorite/index.js richiede il
# codice sorgente di dms tramite path relativi (../dms/authService, ../dms/dmsService):
# stesso identico motivo/pattern di PkManagerFunction/SessionFunction sopra. Include
# anche myPeople/, session/, dmlConfigSync/ e v360/ perché
# pkFavorite/index.js::buildDmsSender chiama dms/dmsService.js
# ::resolveDynamicSenderFields, che risolve dinamicamente mainSincom/market/
# language/dealerCountryCode tramite session/src/sessionContextCache.js (che
# richiede a sua volta myPeople/ e dmlConfigSync/, oltre a dbManager/ già
# presente) e brand tramite v360/v360Service.js::getCachedBrand — stesso
# identico meccanismo di SessionFunction/PkManagerFunction/JobCardFunction.
build-PkFavoriteFunction:
	mkdir -p "$(ARTIFACTS_DIR)/pkFavorite" "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dbManager" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/dmlConfigSync" "$(ARTIFACTS_DIR)/v360"
	cp -r pkFavorite/. "$(ARTIFACTS_DIR)/pkFavorite/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	cp -r v360/. "$(ARTIFACTS_DIR)/v360/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/pkFavorite/__tests__ "$(ARTIFACTS_DIR)"/pkFavorite/coverage "$(ARTIFACTS_DIR)"/pkFavorite/.env* \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md \
		"$(ARTIFACTS_DIR)"/v360/__tests__ "$(ARTIFACTS_DIR)"/v360/coverage "$(ARTIFACTS_DIR)"/v360/.env* "$(ARTIFACTS_DIR)"/v360/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/pkFavorite)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/myPeople)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/session)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/v360)

# JobCardFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché,
# per il flusso di arricchimento prezzo/disponibilità del carrello
# (jobCardService.js::getCartPriceAndAvailability), jobcard/jobCardService.js
# richiede il codice sorgente di dms tramite path relativi (../dms/authService,
# ../dms/dmsService): stesso identico motivo/pattern di
# PkManagerFunction/SessionFunction/PkFavoriteFunction sopra. Include anche
# dbManager/ (db.js + AnagSnowflakesRepository.js) perché dms/dmsService.js
# ::buildApplicationArea (imbarcato in-process insieme a jobcard) risolve
# physicalSiteId/dealerNumberIdSource (tabella woc.ang_snowflakes, stesso Aurora
# "wiadvisor" già usato da PkManagerFunction/SessionFunction) tramite
# require(path.resolve(__dirname, '../dbManager/...')). Include anche
# myPeople/, session/, dmlConfigSync/ e v360/ perché
# jobcard/jobCardService.js::buildDmsSender chiama dms/dmsService.js
# ::resolveDynamicSenderFields (stesso identico meccanismo/stessi sibling di
# PkFavoriteFunction/PkManagerFunction/SessionFunction sopra). Include infine
# agendaSoaNaga/ perché jobcard/index.js::syncAppointmentsToNaga richiede
# require('../agendaSoaNaga/index') per sincronizzare (azione "updatenaga")
# l'appuntamento NAGA dopo un saveJobcard riuscito con payload.appointments[]
# valorizzato (stesso pattern require cross-cartella di PkManager.js).
build-JobCardFunction:
	mkdir -p "$(ARTIFACTS_DIR)/jobcard" "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dbManager" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/dmlConfigSync" "$(ARTIFACTS_DIR)/v360" "$(ARTIFACTS_DIR)/agendaSoaNaga"
	cp -r jobcard/. "$(ARTIFACTS_DIR)/jobcard/"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	cp -r v360/. "$(ARTIFACTS_DIR)/v360/"
	cp -r agendaSoaNaga/. "$(ARTIFACTS_DIR)/agendaSoaNaga/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/jobcard/__tests__ "$(ARTIFACTS_DIR)"/jobcard/coverage "$(ARTIFACTS_DIR)"/jobcard/.env* \
		"$(ARTIFACTS_DIR)"/jobcard/testCart.js "$(ARTIFACTS_DIR)"/jobcard/jobCardDetail-sample.json \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md \
		"$(ARTIFACTS_DIR)"/v360/__tests__ "$(ARTIFACTS_DIR)"/v360/coverage "$(ARTIFACTS_DIR)"/v360/.env* "$(ARTIFACTS_DIR)"/v360/README.md \
		"$(ARTIFACTS_DIR)"/agendaSoaNaga/__tests__ "$(ARTIFACTS_DIR)"/agendaSoaNaga/coverage "$(ARTIFACTS_DIR)"/agendaSoaNaga/.env* "$(ARTIFACTS_DIR)"/agendaSoaNaga/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/jobcard)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/myPeople)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/session)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/v360)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/agendaSoaNaga)

# DjcFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché
# djc/index.js::syncAppointmentsToNaga richiede require('../agendaSoaNaga/index')
# per sincronizzare (azione "updatenaga") l'appuntamento NAGA dopo un
# saveJobcard riuscito con payload.appointments[] valorizzato: stesso identico
# motivo/pattern di JobCardFunction sopra (djc non richiede invece dms/
# dbManager/session/myPeople/dmlConfigSync/v360, non usando
# getCartPriceAndAvailability).
build-DjcFunction:
	mkdir -p "$(ARTIFACTS_DIR)/djc" "$(ARTIFACTS_DIR)/agendaSoaNaga"
	cp -r djc/. "$(ARTIFACTS_DIR)/djc/"
	cp -r agendaSoaNaga/. "$(ARTIFACTS_DIR)/agendaSoaNaga/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/djc/__tests__ "$(ARTIFACTS_DIR)"/djc/coverage "$(ARTIFACTS_DIR)"/djc/.env* \
		"$(ARTIFACTS_DIR)"/agendaSoaNaga/__tests__ "$(ARTIFACTS_DIR)"/agendaSoaNaga/coverage "$(ARTIFACTS_DIR)"/agendaSoaNaga/.env* "$(ARTIFACTS_DIR)"/agendaSoaNaga/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/djc)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/agendaSoaNaga)

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

# DmsFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché
# dms/dmsService.js::buildApplicationArea richiede il codice sorgente di dbManager
# tramite path relativi (../dbManager/db, ../dbManager/AnagSnowflakesRepository)
# per risolvere physicalSiteId/dealerNumberIdSource da woc.ang_snowflakes — stesso
# lookup centralizzato qui e condiviso da tutti i chiamanti di postDmsInquiry
# (jobcard, pkManager, pkFavorite), invece di essere duplicato in ciascuno.
# Include anche myPeople/, session/, dmlConfigSync/ e v360/ perché dms/index.js
# risolve SEMPRE (senza che il chiamante debba passarlo) il Sender dinamico
# dell'azione "inquiry" tramite dmsService.js::resolveDynamicSenderFields
# (stesso meccanismo/pattern già usato da JobCardFunction/PkManagerFunction/
# PkFavoriteFunction/SessionFunction).
build-DmsFunction:
	mkdir -p "$(ARTIFACTS_DIR)/dms" "$(ARTIFACTS_DIR)/dbManager" "$(ARTIFACTS_DIR)/myPeople" "$(ARTIFACTS_DIR)/session" "$(ARTIFACTS_DIR)/dmlConfigSync" "$(ARTIFACTS_DIR)/v360"
	cp -r dms/. "$(ARTIFACTS_DIR)/dms/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	cp -r myPeople/. "$(ARTIFACTS_DIR)/myPeople/"
	cp -r session/. "$(ARTIFACTS_DIR)/session/"
	cp -r dmlConfigSync/. "$(ARTIFACTS_DIR)/dmlConfigSync/"
	cp -r v360/. "$(ARTIFACTS_DIR)/v360/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/dms/__tests__ "$(ARTIFACTS_DIR)"/dms/coverage "$(ARTIFACTS_DIR)"/dms/.env* "$(ARTIFACTS_DIR)"/dms/test.js "$(ARTIFACTS_DIR)"/dms/README.md \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env* \
		"$(ARTIFACTS_DIR)"/myPeople/__tests__ "$(ARTIFACTS_DIR)"/myPeople/coverage "$(ARTIFACTS_DIR)"/myPeople/.env* "$(ARTIFACTS_DIR)"/myPeople/README.md \
		"$(ARTIFACTS_DIR)"/session/__tests__ "$(ARTIFACTS_DIR)"/session/coverage "$(ARTIFACTS_DIR)"/session/.env* \
		"$(ARTIFACTS_DIR)"/dmlConfigSync/__tests__ "$(ARTIFACTS_DIR)"/dmlConfigSync/coverage "$(ARTIFACTS_DIR)"/dmlConfigSync/.env* "$(ARTIFACTS_DIR)"/dmlConfigSync/README.md \
		"$(ARTIFACTS_DIR)"/v360/__tests__ "$(ARTIFACTS_DIR)"/v360/coverage "$(ARTIFACTS_DIR)"/v360/.env* "$(ARTIFACTS_DIR)"/v360/README.md
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dms)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/myPeople)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/session)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dmlConfigSync)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/v360)

# HqManagerFunction (template.yaml) usa `Metadata: BuildMethod: makefile` perché
# HqManager.js richiede il codice sorgente di dbManager tramite path relativi
# (../dbManager/db, ../dbManager/HqRepository) per leggere/scrivere la
# configurazione di abilitazione WOC/firma digitale (woc.hq_application_enabling,
# incrociata con woc.ang_snowflakes/woc.addr_snowflakes) — stesso identico
# motivo/pattern di PkManagerFunction/SessionFunction/DmsFunction sopra.
build-HqManagerFunction:
	mkdir -p "$(ARTIFACTS_DIR)/hqManager" "$(ARTIFACTS_DIR)/dbManager"
	cp -r hqManager/. "$(ARTIFACTS_DIR)/hqManager/"
	cp -r dbManager/. "$(ARTIFACTS_DIR)/dbManager/"
	rm -rf \
		"$(ARTIFACTS_DIR)"/hqManager/__tests__ "$(ARTIFACTS_DIR)"/hqManager/coverage "$(ARTIFACTS_DIR)"/hqManager/.env* \
		"$(ARTIFACTS_DIR)"/dbManager/__tests__ "$(ARTIFACTS_DIR)"/dbManager/coverage "$(ARTIFACTS_DIR)"/dbManager/.env*
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/hqManager)
	$(call npm-ci-prod,$(ARTIFACTS_DIR)/dbManager)
