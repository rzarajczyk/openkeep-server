package com.openkeep.api

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication

@SpringBootApplication
@ConfigurationPropertiesScan
class OpenKeepApplication

fun main(args: Array<String>) {
    runApplication<OpenKeepApplication>(*args)
}
